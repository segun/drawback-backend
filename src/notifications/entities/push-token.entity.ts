import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { PushPlatform } from '../enums/push-platform.enum';
import { PushProvider } from '../enums/push-provider.enum';

@Index('IDX_push_tokens_user_active', ['userId', 'active'])
@Index('UQ_push_tokens_provider_token', ['provider', 'token'], { unique: true })
@Entity('push_tokens')
export class PushToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  user!: User;

  @Column({ type: 'enum', enum: PushProvider })
  provider!: PushProvider;

  @Exclude()
  @Column({ type: 'varchar', length: 512 })
  token!: string;

  @Column({ type: 'enum', enum: PushPlatform })
  platform!: PushPlatform;

  @Column({ type: 'varchar', length: 255 })
  deviceId!: string;

  @Column({ default: true })
  active!: boolean;

  @Column({ type: 'varchar', length: 100, nullable: true })
  deactivationReason!: string | null;

  @Column({ type: 'datetime', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
