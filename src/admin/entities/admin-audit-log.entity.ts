import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AdminAction } from '../enums/admin-action.enum';

@Entity('admin_audit_logs')
@Index(['adminId', 'createdAt'])
export class AdminAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  adminId!: string;

  @Column({ type: 'enum', enum: AdminAction })
  action!: AdminAction;

  @Column({ type: 'json' })
  targetUserIds!: string[];

  @Column({ type: 'json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
