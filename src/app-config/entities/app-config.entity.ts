import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface AppConfigData {
  ads: {
    provider: string;
  };
  temporaryDiscoveryAccessDurationMinutes: number;
}

export interface UserConfigOverridesData {
  ads?: {
    provider?: string;
  };
}

@Entity('app_config')
export class AppConfig {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'json', nullable: false })
  config!: AppConfigData;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
