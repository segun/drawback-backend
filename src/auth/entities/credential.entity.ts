import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Entity('credentials')
export class Credential {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 36 })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Exclude()
  @Column({ type: 'blob' })
  credentialId!: Buffer;

  @Exclude()
  @Column({ type: 'blob' })
  publicKey!: Buffer;

  @Exclude()
  @Column({ type: 'bigint', default: 0 })
  counter!: number;

  @Exclude()
  @Column({ type: 'json', nullable: true })
  transports!: string[] | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  deviceId!: string | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  platform!: string | null;

  @Column({ type: 'datetime', nullable: true })
  lastUsedAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
