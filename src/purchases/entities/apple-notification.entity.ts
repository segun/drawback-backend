import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Tracks processed Apple App Store Server Notifications for idempotency.
 * Prevents duplicate processing of the same notification.
 */
@Entity('apple_notifications')
export class AppleNotification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 255 })
  notificationUUID!: string;

  @Column({ type: 'varchar', length: 50 })
  notificationType!: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  originalTransactionId!: string | null;

  @Column({ type: 'text', nullable: true })
  rawPayload!: string | null;

  @CreateDateColumn()
  processedAt!: Date;
}
