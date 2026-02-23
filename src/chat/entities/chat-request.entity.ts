import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ChatRequestStatus } from '../enums/chat-request-status.enum';

@Entity('chat_requests')
export class ChatRequest {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  fromUserId!: string;

  @Column({ type: 'uuid' })
  toUserId!: string;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'fromUserId' })
  fromUser!: User;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'toUserId' })
  toUser!: User;

  @Column({
    type: 'enum',
    enum: ChatRequestStatus,
    default: ChatRequestStatus.PENDING,
  })
  status!: ChatRequestStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
