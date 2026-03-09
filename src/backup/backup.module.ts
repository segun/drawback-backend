import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { MongoBackupRepository } from './mongo-backup.repository';
import { MySqlDumpService } from './mysql-dump.service';
import { BackupSchedulerService } from './backup-scheduler.service';

@Module({
  providers: [
    BackupService,
    MongoBackupRepository,
    MySqlDumpService,
    BackupSchedulerService,
  ],
  exports: [BackupService],
})
export class BackupModule {}
