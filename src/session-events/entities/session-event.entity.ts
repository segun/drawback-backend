import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { SessionEventType } from '../enums/session-event-type.enum';

@Entity('session_events')
export class SessionEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column('uuid')
  @Index('IDX_session_events_userId')
  userId!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({
    type: 'enum',
    enum: SessionEventType,
  })
  @Index('IDX_session_events_eventType')
  eventType!: SessionEventType;

  @Column('varchar', { length: 45, nullable: true })
  ipAddress?: string;

  @Column('json', { nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  @Index('IDX_session_events_createdAt')
  createdAt!: Date;
}
