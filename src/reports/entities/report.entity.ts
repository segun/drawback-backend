import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { User } from '../../users/entities/user.entity';
import { ReportType } from '../enums/report-type.enum';
import { ReportStatus } from '../enums/report-status.enum';

@Entity('reports')
export class Report {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  reporterId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reporterId' })
  reporter!: User;

  @Column('uuid')
  reportedUserId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'reportedUserId' })
  reportedUser!: User;

  @Column({
    type: 'enum',
    enum: ReportType,
  })
  reportType!: ReportType;

  @Column('text')
  description!: string;

  @Column('uuid', { nullable: true })
  chatRequestId?: string;

  @Column('varchar', { length: 255, nullable: true })
  sessionContext?: string;

  @Column({
    type: 'enum',
    enum: ReportStatus,
    default: ReportStatus.PENDING,
  })
  status!: ReportStatus;

  @Column('text', { nullable: true })
  @Exclude()
  adminNotes?: string;

  @Column('uuid', { nullable: true })
  @Exclude()
  resolvedBy?: string;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'resolvedBy' })
  @Exclude()
  resolver?: User;

  @Column({ type: 'timestamp', nullable: true })
  @Exclude()
  resolvedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
