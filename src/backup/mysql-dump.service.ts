import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { spawn } from 'child_process';
import { once } from 'events';
import { createConnection } from 'mysql2/promise';
import { BackupScope } from './backup.types';

interface DumpProcess {
  stream: NodeJS.ReadableStream;
  completion: Promise<void>;
}

@Injectable()
export class MySqlDumpService {
  constructor(private readonly configService: ConfigService) {}

  async createDump(scope: BackupScope): Promise<DumpProcess> {
    await this.ensureBinariesAvailable();

    const database = this.require('DB_NAME');
    const child = spawn(
      this.mysqldumpBinary(),
      this.dumpArgs(scope, database),
      {
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const stderrChunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const completion = (async () => {
      const [code] = (await once(child, 'exit')) as [number | null];
      if (code !== 0) {
        const message = Buffer.concat(stderrChunks).toString('utf8').trim();
        throw new Error(`mysqldump failed (${code}): ${message}`);
      }
    })();

    if (!child.stdout) {
      throw new Error('Failed to capture mysqldump stdout stream');
    }

    return {
      stream: child.stdout,
      completion,
    };
  }

  async restoreFromStream(stream: NodeJS.ReadableStream): Promise<void> {
    await this.ensureBinariesAvailable();

    const database = this.require('DB_NAME');
    const child = spawn(this.mysqlBinary(), this.restoreArgs(database), {
      stdio: ['pipe', 'ignore', 'pipe'],
    });

    const stderrChunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    const stdin = child.stdin;
    if (!stdin) {
      throw new Error('Failed to open mysql stdin stream for restore');
    }

    let streamError: Error | null = null;
    const streamPromise = new Promise<void>((resolve, reject) => {
      stream.on('error', (err: Error) => {
        streamError = err;
        reject(err);
      });
      stdin.on('error', (err: Error) => reject(err));
      stream.on('end', () => {
        if (streamError) {
          reject(streamError);
        } else {
          resolve();
        }
      });
      stream.pipe(stdin);
    });

    const completion = (async () => {
      const [code] = (await once(child, 'exit')) as [number | null];
      if (code !== 0) {
        const message = Buffer.concat(stderrChunks).toString('utf8').trim();
        throw new Error(`mysql restore failed (${code}): ${message}`);
      }
    })();

    try {
      await Promise.all([streamPromise, completion]);
    } catch (error) {
      // Ensure mysql process is killed if stream or restore fails
      if (!child.killed) {
        child.kill('SIGTERM');
      }
      throw error;
    }
  }

  async clearSchema(): Promise<void> {
    const connection = await createConnection({
      host: this.require('DB_HOST'),
      port: Number(this.require('DB_PORT')),
      user: this.require('DB_USER'),
      password: this.require('DB_PASSWORD'),
      database: this.require('DB_NAME'),
      multipleStatements: true,
    });

    try {
      const [rows] = await connection.query(
        `
          SELECT table_name AS tableName
          FROM information_schema.tables
          WHERE table_schema = ?
        `,
        [this.require('DB_NAME')],
      );

      const tableRows = rows as Array<{ tableName: string }>;
      if (tableRows.length === 0) {
        return;
      }

      await connection.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const row of tableRows) {
        // Table names come from information_schema; quoting protects reserved words.
        await connection.query(`DROP TABLE IF EXISTS \`${row.tableName}\``);
      }
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      await connection.end();
    }
  }

  private dumpArgs(scope: BackupScope, database: string): string[] {
    const args = [
      `--host=${this.require('DB_HOST')}`,
      `--port=${this.require('DB_PORT')}`,
      `--user=${this.require('DB_USER')}`,
      `--password=${this.require('DB_PASSWORD')}`,
      '--single-transaction',
      '--quick',
      '--skip-lock-tables',
      '--add-drop-table',
      '--set-gtid-purged=OFF',
    ];

    if (scope === 'data_only') {
      args.push('--no-create-info', '--skip-triggers');
    }

    args.push(database);
    return args;
  }

  private restoreArgs(database: string): string[] {
    return [
      `--host=${this.require('DB_HOST')}`,
      `--port=${this.require('DB_PORT')}`,
      `--user=${this.require('DB_USER')}`,
      `--password=${this.require('DB_PASSWORD')}`,
      database,
    ];
  }

  private async ensureBinariesAvailable(): Promise<void> {
    await this.checkBinary(this.mysqldumpBinary());
    await this.checkBinary(this.mysqlBinary());
  }

  private async checkBinary(binary: string): Promise<void> {
    const child = spawn(binary, ['--version'], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });

    const stderrChunks: Buffer[] = [];
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    try {
      const [code] = (await once(child, 'exit')) as [number | null];
      if (code !== 0) {
        const details = Buffer.concat(stderrChunks).toString('utf8').trim();
        throw new Error(`${binary} is not available (${code}): ${details}`);
      }
    } catch (error) {
      throw new Error(
        `Required binary '${binary}' is not available. ${String(error)}`,
      );
    }
  }

  private mysqldumpBinary(): string {
    return this.configService.get<string>('MYSQLDUMP_BIN') || 'mysqldump';
  }

  private mysqlBinary(): string {
    return this.configService.get<string>('MYSQL_BIN') || 'mysql';
  }

  private require(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value) {
      throw new Error(`Missing required environment variable: ${key}`);
    }

    return value;
  }
}
