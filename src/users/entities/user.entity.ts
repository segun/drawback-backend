import { Exclude, Transform } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserMode } from '../enums/user-mode.enum';
import { UserRole } from '../enums/user-role.enum';
import { Subscription } from './subscription.entity';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true, length: 254 })
  email!: string;

  @Exclude()
  @Column({ length: 255 })
  passwordHash!: string;

  @Column({ unique: true, length: 30 })
  displayName!: string;

  @Exclude()
  @Column({ default: false })
  @Transform(({ value }) => Boolean(value))
  isActivated!: boolean;

  @Exclude()
  @Column({ type: 'varchar', nullable: true, length: 128 })
  activationToken!: string | null;

  @Exclude()
  @Column({ type: 'datetime', nullable: true })
  activationTokenExpiry!: Date | null;

  @Column({ type: 'enum', enum: UserMode, default: UserMode.PRIVATE })
  mode!: UserMode;

  @Column({ default: true })
  @Transform(({ value }) => Boolean(value))
  appearInSearches!: boolean;

  @Column({ default: false })
  @Transform(({ value }) => Boolean(value))
  appearInDiscoveryGame!: boolean;

  @Column({ type: 'varchar', length: 512, nullable: true })
  discoveryImageUrl!: string | null;

  @Column({ default: false })
  @Transform(({ value }) => Boolean(value))
  hasDiscoveryAccess!: boolean;

  @Column({ type: 'datetime', nullable: true })
  temporaryDiscoveryAccessExpiresAt!: Date | null;

  @Column({ type: 'enum', enum: UserRole, default: UserRole.USER })
  role!: UserRole;

  @Column({ default: false })
  @Transform(({ value }) => Boolean(value))
  isBlocked!: boolean;

  @Exclude()
  @Column({ type: 'datetime', nullable: true })
  blockedAt!: Date | null;

  @Exclude()
  @Column({ type: 'varchar', nullable: true, length: 500 })
  blockedReason!: string | null;

  @Exclude()
  @Column({ type: 'varchar', nullable: true, length: 128 })
  resetToken!: string | null;

  @Exclude()
  @Column({ type: 'datetime', nullable: true })
  resetTokenExpiry!: Date | null;

  @Exclude()
  @Column({ type: 'varchar', nullable: true, length: 128 })
  deleteToken!: string | null;

  @Exclude()
  @Column({ type: 'datetime', nullable: true })
  deleteTokenExpiry!: Date | null;

  @Exclude()
  @Column({ type: 'json', nullable: true })
  configOverrides!: { ads?: { provider?: string } } | null;

  @OneToOne(() => Subscription, (subscription) => subscription.user, {
    nullable: true,
  })
  subscription?: Subscription;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
