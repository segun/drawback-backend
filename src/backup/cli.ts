import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { BackupService } from './backup.service';

interface CliArgs {
  command: 'list' | 'restore';
  backupId?: string;
  source?: 'latest-periodic' | 'latest-rolling';
  limit?: number;
}

function parseArgs(): CliArgs {
  const [commandRaw, ...rest] = process.argv.slice(2);
  const command = commandRaw as 'list' | 'restore';

  if (command !== 'list' && command !== 'restore') {
    throw new Error(
      'Usage: yarn backup:list [--limit=30] OR yarn backup:restore [--id=<backupId>] [--source=latest-periodic|latest-rolling]',
    );
  }

  const args: CliArgs = { command };

  for (const token of rest) {
    if (token.startsWith('--id=')) {
      args.backupId = token.slice('--id='.length);
      continue;
    }

    if (token.startsWith('--source=')) {
      const source = token.slice('--source='.length);
      if (source !== 'latest-periodic' && source !== 'latest-rolling') {
        throw new Error('--source must be latest-periodic or latest-rolling');
      }
      args.source = source;
      continue;
    }

    if (token.startsWith('--limit=')) {
      const parsed = Number(token.slice('--limit='.length));
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error('--limit must be a positive number');
      }
      args.limit = parsed;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

async function main() {
  process.env.BACKUP_PERIODIC_ENABLED = 'false';

  const args = parseArgs();
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });

  // Handle graceful shutdown on SIGINT/SIGTERM
  let isShuttingDown = false;
  const shutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    console.log(`\n${signal} received, shutting down gracefully...`);
    await app.close();
    process.exit(130); // Standard exit code for SIGINT
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    const backupService = app.get(BackupService);

    if (args.command === 'list') {
      const backups = await backupService.listBackups(args.limit || 30);
      if (backups.length === 0) {
        console.log('No backups found.');
        return;
      }

      for (const backup of backups) {
        console.log(
          [
            backup.id,
            backup.type,
            backup.scope,
            backup.source,
            backup.sizeBytes,
            backup.createdAt.toISOString(),
            backup.filename,
          ].join('\t'),
        );
      }
      return;
    }

    // Restore command
    const backups = await backupService.listBackups(10);
    console.log('Latest backups:');
    backups.slice(0, 5).forEach((b) => {
      console.log(
        `  ${b.id} - ${b.type.padEnd(15)} - ${b.scope.padEnd(10)} - ${b.createdAt.toISOString()}`,
      );
    });

    console.log('\n⚠️  WARNING: This will REPLACE all data in the database!');
    console.log('A pre-restore backup will be created automatically.\n');

    // Get confirmation
    const readline = await import('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const confirmed = await new Promise<boolean>((resolve) => {
      rl.question('Type "CONFIRM" to proceed: ', (answer) => {
        rl.close();
        resolve(answer.trim() === 'CONFIRM');
      });
    });

    if (!confirmed) {
      console.log('Restore cancelled.');
      return;
    }

    const result = await backupService.restoreFromBackup({
      backupId: args.backupId,
      source: args.source,
    });

    console.log('Restore completed');
    console.log(`restoredFromBackupId=${result.restoredFromBackupId}`);
    console.log(`restoredFromType=${result.restoredFromType}`);
    console.log(`preRestoreBackupId=${result.preRestoreBackupId}`);
    console.log(`restoredAt=${result.restoredAt.toISOString()}`);
  } finally {
    if (!isShuttingDown) {
      await app.close();
    }
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error: unknown) => {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    console.error('Fatal error:', errorMessage);
    if (errorStack) {
      console.error(errorStack);
    }
    process.exit(1);
  });
