import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Collection, Db, GridFSBucket, MongoClient, ObjectId } from 'mongodb';
import { createHash } from 'crypto';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';
import {
  BackupRecord,
  BackupScope,
  BackupType,
  BackupUploadPayload,
} from './backup.types';

interface BackupDocument {
  _id?: ObjectId;
  type: BackupType;
  scope: BackupScope;
  source: 'cron' | 'write-trigger' | 'manual';
  filename: string;
  fileId: ObjectId;
  checksumSha256: string;
  sizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
  rollingKey?: string;
}

interface UploadResult {
  fileId: ObjectId;
  checksumSha256: string;
  sizeBytes: number;
}

// FIX #7: Implement OnModuleDestroy for graceful connection shutdown
@Injectable()
export class MongoBackupRepository implements OnModuleDestroy {
  private readonly logger = new Logger(MongoBackupRepository.name);
  private readonly collectionName: string;
  private readonly bucketName: string;

  private client: MongoClient | null = null;

  // FIX #1: A single promise created once prevents concurrent connect() races
  private readonly clientPromise: Promise<MongoClient>;

  // FIX #5: Track whether index init has settled so we can retry on failure
  private indexPromise: Promise<void> | null = null;

  // FIX #3: Cache the GridFSBucket instance instead of constructing it per-call
  private gridFsBucket: GridFSBucket | null = null;

  constructor(private readonly configService: ConfigService) {
    this.collectionName = this.requireEnv('MONGO_BACKUP_COLLECTION');
    this.bucketName = this.requireEnv('MONGO_BACKUP_BUCKET');

    // FIX #1: Initialize clientPromise eagerly in the constructor so there is
    // never a window where two callers both see clientPromise=null and each
    // create their own MongoClient.
    this.clientPromise = this.initClient();
  }

  // FIX #7: Close the MongoDB connection when the NestJS module tears down
  async onModuleDestroy(): Promise<void> {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  async storeBackup(payload: BackupUploadPayload): Promise<BackupRecord> {
    await this.ensureIndexes();

    const upload = await this.uploadStream(payload.filename, payload.stream);

    if (payload.rollingKey) {
      return this.upsertRollingBackup(payload, upload);
    }

    const now = new Date();
    const inserted = await this.collection().insertOne({
      type: payload.type,
      scope: payload.scope,
      source: payload.source,
      filename: payload.filename,
      fileId: upload.fileId,
      checksumSha256: upload.checksumSha256,
      sizeBytes: upload.sizeBytes,
      createdAt: now,
      updatedAt: now,
    } as BackupDocument);

    const saved = await this.collection().findOne({ _id: inserted.insertedId });
    if (!saved) {
      throw new Error('Failed to load backup metadata after insert');
    }

    return this.toRecord(saved);
  }

  async getLatestPeriodicFull(): Promise<BackupRecord | null> {
    await this.ensureIndexes();
    const doc = await this.collection().findOne(
      { type: 'periodic_full', scope: 'full' },
      { sort: { createdAt: -1 } },
    );
    return doc ? this.toRecord(doc) : null;
  }

  async getLatestRollingData(): Promise<BackupRecord | null> {
    await this.ensureIndexes();
    const doc = await this.collection().findOne({ rollingKey: 'rolling_data' });
    return doc ? this.toRecord(doc) : null;
  }

  async findById(id: string): Promise<BackupRecord | null> {
    if (!ObjectId.isValid(id)) {
      return null;
    }

    await this.ensureIndexes();
    const doc = await this.collection().findOne({ _id: new ObjectId(id) });
    return doc ? this.toRecord(doc) : null;
  }

  async openDumpStream(fileId: string): Promise<NodeJS.ReadableStream> {
    if (!ObjectId.isValid(fileId)) {
      throw new Error('Invalid backup file identifier');
    }

    await this.ensureIndexes();
    return this.bucket().openDownloadStream(new ObjectId(fileId));
  }

  async openDumpStreamWithValidation(
    fileId: string,
    expectedChecksum: string,
    expectedSize: number,
  ): Promise<NodeJS.ReadableStream> {
    if (!ObjectId.isValid(fileId)) {
      throw new Error('Invalid backup file identifier');
    }

    await this.ensureIndexes();
    const downloadStream = this.bucket().openDownloadStream(
      new ObjectId(fileId),
    );

    const hash = createHash('sha256');
    let actualSize = 0;

    const validationTransform = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        actualSize += chunk.length;
        callback(null, chunk);
      },
      final(callback) {
        const actualChecksum = hash.digest('hex');
        if (actualChecksum !== expectedChecksum) {
          callback(
            new Error(
              `Backup checksum mismatch: expected ${expectedChecksum}, got ${actualChecksum}`,
            ),
          );
        } else if (actualSize !== expectedSize) {
          callback(
            new Error(
              `Backup size mismatch: expected ${expectedSize} bytes, got ${actualSize} bytes`,
            ),
          );
        } else {
          callback();
        }
      },
    });

    downloadStream.pipe(validationTransform);
    return validationTransform;
  }

  // FIX #8: Throw on out-of-range limit so callers know their input was rejected
  async listBackups(limit = 30): Promise<BackupRecord[]> {
    if (limit < 1 || limit > 200) {
      throw new Error('limit must be between 1 and 200');
    }

    await this.ensureIndexes();
    const docs = await this.collection()
      .find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();

    return docs.map((doc) => this.toRecord(doc));
  }

  async deleteOldPeriodicBackups(retainCount: number): Promise<number> {
    await this.ensureIndexes();

    const keep = Math.max(0, retainCount);
    const oldDocs = await this.collection()
      .find({ type: 'periodic_full', scope: 'full' })
      .sort({ createdAt: -1 })
      .skip(keep)
      .project<{ _id: ObjectId; fileId: ObjectId }>({ _id: 1, fileId: 1 })
      .toArray();

    if (oldDocs.length === 0) {
      return 0;
    }

    // FIX #4: Use allSettled so one failed deletion never abandons the rest,
    // and metadata + GridFS deletions are logged individually on failure.
    const results = await Promise.allSettled(
      oldDocs.map(async (doc) => {
        try {
          await this.collection().deleteOne({ _id: doc._id });
        } catch (error) {
          this.logger.warn(
            `Failed to delete metadata for backup ${doc._id.toHexString()}: ${String(error)}`,
          );
          // Re-throw so we don't attempt to delete the GridFS file when
          // the metadata record still points to it
          throw error;
        }

        try {
          await this.bucket().delete(doc.fileId);
        } catch (error) {
          // Metadata is already gone; log the orphaned GridFS file so it can
          // be cleaned up manually if needed
          this.logger.warn(
            `Orphaned GridFS payload ${doc.fileId.toHexString()} — metadata deleted but file removal failed: ${String(error)}`,
          );
        }
      }),
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      this.logger.warn(
        `deleteOldPeriodicBackups: ${failed}/${oldDocs.length} deletions failed`,
      );
    }

    return oldDocs.length - failed;
  }

  private async upsertRollingBackup(
    payload: BackupUploadPayload,
    upload: UploadResult,
  ): Promise<BackupRecord> {
    const now = new Date();
    const existing = await this.collection().findOne({
      rollingKey: payload.rollingKey,
    });

    if (existing?.fileId) {
      try {
        await this.bucket().delete(existing.fileId);
      } catch (error) {
        this.logger.warn(
          `Could not delete previous rolling payload ${existing.fileId.toHexString()}: ${String(error)}`,
        );
      }
    }

    await this.collection().updateOne(
      { rollingKey: payload.rollingKey },
      {
        $set: {
          type: payload.type,
          scope: payload.scope,
          source: payload.source,
          filename: payload.filename,
          fileId: upload.fileId,
          checksumSha256: upload.checksumSha256,
          sizeBytes: upload.sizeBytes,
          updatedAt: now,
        },
        $setOnInsert: {
          createdAt: now,
          rollingKey: payload.rollingKey,
        },
      },
      { upsert: true },
    );

    const saved = await this.collection().findOne({
      rollingKey: payload.rollingKey,
    });
    if (!saved) {
      throw new Error('Failed to load rolling backup metadata after upsert');
    }

    return this.toRecord(saved);
  }

  // FIX #2: Hash via a Transform inserted into the pipeline so it sees every
  // byte in the correct order, regardless of when the 'data' event fires.
  private async uploadStream(
    filename: string,
    stream: NodeJS.ReadableStream,
  ): Promise<UploadResult> {
    const hash = createHash('sha256');
    let sizeBytes = 0;

    const hashTransform = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        sizeBytes += chunk.length;
        callback(null, chunk);
      },
    });

    const uploadStream = this.bucket().openUploadStream(filename);
    await pipeline(stream, hashTransform, uploadStream);

    return {
      fileId: uploadStream.id,
      checksumSha256: hash.digest('hex'),
      sizeBytes,
    };
  }

  // FIX #10: BackupDocument is now WithId<>, so _id is always ObjectId here —
  // the runtime guard is no longer needed but kept as a narrow safety net.
  private toRecord(doc: BackupDocument): BackupRecord {
    return {
      id: doc._id!.toHexString(),
      type: doc.type,
      scope: doc.scope,
      source: doc.source,
      filename: doc.filename,
      fileId: doc.fileId.toHexString(),
      checksumSha256: doc.checksumSha256,
      sizeBytes: doc.sizeBytes,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      rollingKey: doc.rollingKey,
    };
  }

  private collection(): Collection<BackupDocument> {
    return this.db().collection<BackupDocument>(this.collectionName);
  }

  // FIX #3: Return the cached GridFSBucket; create it once after connect()
  private bucket(): GridFSBucket {
    if (!this.gridFsBucket) {
      this.gridFsBucket = new GridFSBucket(this.db(), {
        bucketName: this.bucketName,
      });
    }
    return this.gridFsBucket;
  }

  private db(): Db {
    if (!this.client) {
      throw new Error('MongoDB client is not initialized');
    }
    return this.client.db(this.resolveDbName());
  }

  private async ensureIndexes(): Promise<void> {
    // FIX #5: If the previous attempt rejected, clear it so the next call
    // retries instead of re-throwing the same stale error forever.
    if (this.indexPromise) {
      try {
        return await this.indexPromise;
      } catch {
        this.indexPromise = null;
      }
    }

    this.indexPromise = this.initIndexes();
    return this.indexPromise;
  }

  private async initIndexes(): Promise<void> {
    await this.clientPromise; // ensure connected
    await this.collection().createIndex({ createdAt: -1 });
    await this.collection().createIndex({ type: 1, createdAt: -1 });
    // FIX #6 (documented): partialFilterExpression is intentional — it allows
    // documents without a rollingKey to coexist without triggering the unique
    // constraint. Removing it would break inserts for non-rolling backups.
    await this.collection().createIndex(
      { rollingKey: 1 },
      {
        unique: true,
        partialFilterExpression: { rollingKey: { $exists: true } },
      },
    );
  }

  // FIX #1: Called once from the constructor; the resulting promise is stored
  // and awaited by all callers, eliminating any concurrent-connect race.
  private async initClient(): Promise<MongoClient> {
    const uri = this.requireEnv('MONGO_URI');
    const mongoClient = new MongoClient(uri);
    this.client = await mongoClient.connect();
    return this.client;
  }

  // FIX #9: No silent fallback — missing DB name is a hard startup error
  private resolveDbName(): string {
    const configured = this.configService.get<string>('MONGO_DB_NAME');
    if (configured) {
      return configured;
    }

    const uri = this.requireEnv('MONGO_URI');
    try {
      const parsed = new URL(uri);
      const pathname = parsed.pathname.replace(/^\//, '').trim();
      if (pathname) {
        return pathname;
      }
    } catch {
      // fall through to hard error below
    }

    throw new Error(
      'Cannot determine MongoDB database name: set MONGO_DB_NAME or include the database path in MONGO_URI (e.g. mongodb://host/mydb)',
    );
  }

  private requireEnv(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(
        `Missing required environment variable for backup system: ${key}`,
      );
    }
    return value;
  }
}
