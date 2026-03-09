import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongoBackupRepository } from './mongo-backup.repository';
import { MySqlDumpService } from './mysql-dump.service';
import {
  BackupRecord,
  BackupScope,
  BackupType,
  RestoreResult,
} from './backup.types';

interface RestoreOptions {
  backupId?: string;
  source?: 'latest-periodic' | 'latest-rolling';
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  private operationActive = false;

  constructor(
    private readonly mongoBackupRepository: MongoBackupRepository,
    private readonly mySqlDumpService: MySqlDumpService,
    private readonly configService: ConfigService,
  ) {}

  async runPeriodicBackup(source: 'cron' | 'manual' = 'cron') {
    return this.runExclusive('periodic backup', async () => {
      const backup = await this.runBackup({
        type: 'periodic_full',
        scope: 'full',
        source,
      });

      const retainCount = Number(
        this.configService.get<string>('BACKUP_PERIODIC_RETENTION_COUNT') ||
          '120',
      );
      const removed =
        await this.mongoBackupRepository.deleteOldPeriodicBackups(retainCount);

      if (removed > 0) {
        this.logger.log(`Removed ${removed} old periodic backups`);
      }

      return backup;
    });
  }

  async listBackups(limit = 30): Promise<BackupRecord[]> {
    return this.mongoBackupRepository.listBackups(limit);
  }

  async restoreFromBackup(
    options: RestoreOptions = {},
  ): Promise<RestoreResult> {
    const source = options.source || 'latest-periodic';

    return this.runExclusive('restore', async () => {
      const selected = await this.resolveRestoreTarget(
        options.backupId,
        source,
      );

      // Validate backup exists and is readable before creating pre-restore backup
      this.logger.log(
        `Validating backup ${selected.id} before restore (checksum: ${selected.checksumSha256.slice(0, 8)}...)`,
      );
      const testStream = await this.mongoBackupRepository.openDumpStream(
        selected.fileId,
      );
      await new Promise<void>((resolve, reject) => {
        let resolved = false;
        testStream.once('readable', () => {
          resolved = true;
          resolve();
        });
        testStream.once('error', (err: Error) => {
          resolved = true;
          reject(err);
        });
        // Timeout after 5 seconds if stream doesn't become readable
        setTimeout(() => {
          if (!resolved) {
            reject(new Error('Backup stream validation timeout'));
          }
        }, 5000);
      });
      // Close test stream (force type to include destroy method)
      (
        testStream as NodeJS.ReadableStream & { destroy?: () => void }
      ).destroy?.();

      // Now create pre-restore backup
      const preRestore = await this.runBackup({
        type: 'pre_restore',
        scope: 'full',
        source: 'manual',
      });

      // Open stream with checksum validation
      const dumpStream =
        await this.mongoBackupRepository.openDumpStreamWithValidation(
          selected.fileId,
          selected.checksumSha256,
          selected.sizeBytes,
        );

      if (selected.scope === 'full') {
        await this.mySqlDumpService.clearSchema();
      }

      await this.mySqlDumpService.restoreFromStream(dumpStream);

      this.logger.log(
        `Restore completed from backup ${selected.id} (${selected.type})`,
      );

      return {
        restoredFromBackupId: selected.id,
        restoredFromType: selected.type,
        restoredFromScope: selected.scope,
        preRestoreBackupId: preRestore.id,
        restoredAt: new Date(),
      };
    });
  }

  private async resolveRestoreTarget(
    backupId?: string,
    source: 'latest-periodic' | 'latest-rolling' = 'latest-periodic',
  ): Promise<BackupRecord> {
    if (backupId) {
      const byId = await this.mongoBackupRepository.findById(backupId);
      if (!byId) {
        throw new NotFoundException(`Backup not found: ${backupId}`);
      }

      return byId;
    }

    if (source === 'latest-rolling') {
      const latestRolling =
        await this.mongoBackupRepository.getLatestRollingData();
      if (!latestRolling) {
        throw new NotFoundException('No rolling backup found');
      }

      return latestRolling;
    }

    const latestPeriodic =
      await this.mongoBackupRepository.getLatestPeriodicFull();
    if (!latestPeriodic) {
      throw new NotFoundException('No periodic full backup found');
    }

    return latestPeriodic;
  }

  private async runBackup(params: {
    type: BackupType;
    scope: BackupScope;
    source: 'cron' | 'write-trigger' | 'manual';
    rollingKey?: string;
  }): Promise<BackupRecord> {
    const now = new Date();
    const filename = this.buildFilename(params.type, params.scope, now);
    const dump = await this.mySqlDumpService.createDump(params.scope);

    const savePromise = this.mongoBackupRepository.storeBackup({
      type: params.type,
      scope: params.scope,
      source: params.source,
      filename,
      stream: dump.stream,
      rollingKey: params.rollingKey,
    });

    const [savedBackup] = await Promise.all([savePromise, dump.completion]);

    this.logger.log(
      `Backup created: ${savedBackup.id} (${savedBackup.type}, ${savedBackup.scope})`,
    );

    return savedBackup;
  }

  private buildFilename(
    type: BackupType,
    scope: BackupScope,
    now: Date,
  ): string {
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const hh = String(now.getUTCHours()).padStart(2, '0');
    const min = String(now.getUTCMinutes()).padStart(2, '0');
    const sec = String(now.getUTCSeconds()).padStart(2, '0');
    return `${type}_${scope}_${yyyy}${mm}${dd}_${hh}${min}${sec}.sql`;
  }

  private async runExclusive<T>(
    operation: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (this.operationActive) {
      throw new BadRequestException(
        `Cannot run ${operation}; another backup operation is already running`,
      );
    }

    this.operationActive = true;
    try {
      return await fn();
    } finally {
      this.operationActive = false;
    }
  }
}
