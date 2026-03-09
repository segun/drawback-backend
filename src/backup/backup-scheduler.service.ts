import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CronJob } from 'cron';
import { SchedulerRegistry } from '@nestjs/schedule';
import { BackupService } from './backup.service';

const PERIODIC_JOB_NAME = 'periodic-full-backup';

@Injectable()
export class BackupSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupSchedulerService.name);

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly backupService: BackupService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    if (!this.isPeriodicEnabled()) {
      this.logger.warn(
        'Periodic backups are disabled (BACKUP_PERIODIC_ENABLED=false)',
      );
      return;
    }

    const cronExpression =
      this.configService.get<string>('BACKUP_PERIODIC_CRON') || '0 */2 * * *';
    const timezone = this.configService.get<string>('BACKUP_TIMEZONE') || 'UTC';

    const job = CronJob.from({
      cronTime: cronExpression,
      timeZone: timezone,
      onTick: () => {
        void this.runPeriodicTick();
      },
    });

    this.schedulerRegistry.addCronJob(PERIODIC_JOB_NAME, job);
    job.start();

    this.logger.log(
      `Periodic backup job started (${cronExpression}, timezone=${timezone})`,
    );
  }

  onModuleDestroy(): void {
    const existing = this.schedulerRegistry
      .getCronJobs()
      .get(PERIODIC_JOB_NAME);
    if (existing) {
      void existing.stop();
      void this.schedulerRegistry.deleteCronJob(PERIODIC_JOB_NAME);
    }
  }

  private async runPeriodicTick(): Promise<void> {
    try {
      await this.backupService.runPeriodicBackup('cron');
    } catch (error) {
      this.logger.error(`Periodic backup failed: ${String(error)}`);
    }
  }

  private isPeriodicEnabled(): boolean {
    const value = this.configService.get<string>('BACKUP_PERIODIC_ENABLED');
    return value?.toLowerCase() !== 'false';
  }
}
