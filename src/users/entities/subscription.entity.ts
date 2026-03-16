import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from './user.entity';

@Entity('subscriptions')
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @OneToOne(() => User, (user) => user.subscription, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({ type: 'varchar', length: 20 })
  platform!: string; // 'ios' | 'android'

  @Column({ type: 'varchar', length: 50 })
  tier!: string; // Product ID: 'monthly' | 'quarterly' | 'yearly' | 'discovery_unlock_forever'

  @Column({ type: 'varchar', length: 20 })
  status!: string; // 'active' | 'expired' | 'cancelled' | etc.

  @Column({ type: 'datetime' })
  startDate!: Date;

  @Column({ type: 'datetime' })
  endDate!: Date;

  @Column({ default: false })
  autoRenew!: boolean;

  @Exclude()
  @Column({ type: 'varchar', length: 255, nullable: true })
  originalTransactionId!: string | null;

  @Exclude()
  @Column({ type: 'text' })
  purchaseToken!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
