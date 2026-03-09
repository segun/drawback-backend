export type BackupType = 'periodic_full' | 'rolling_data' | 'pre_restore';

export type BackupScope = 'full' | 'data_only';

export type BackupSource = 'cron' | 'write-trigger' | 'manual';

export interface BackupRecord {
  id: string;
  type: BackupType;
  scope: BackupScope;
  source: BackupSource;
  filename: string;
  fileId: string;
  checksumSha256: string;
  sizeBytes: number;
  createdAt: Date;
  updatedAt: Date;
  rollingKey?: string;
}

export interface BackupUploadPayload {
  type: BackupType;
  scope: BackupScope;
  source: BackupSource;
  filename: string;
  stream: NodeJS.ReadableStream;
  rollingKey?: string;
}

export interface RestoreResult {
  restoredFromBackupId: string;
  restoredFromType: BackupType;
  restoredFromScope: BackupScope;
  preRestoreBackupId: string;
  restoredAt: Date;
}
