import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { ChatRequest } from './chat-request.entity';

@Entity('saved_chats')
@Unique(['chatRequestId', 'savedByUserId'])
export class SavedChat {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  chatRequestId!: string;

  @Column({ type: 'uuid' })
  savedByUserId!: string;

  @ManyToOne(() => ChatRequest, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'chatRequestId' })
  chatRequest!: ChatRequest;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'savedByUserId' })
  savedBy!: User;

  @CreateDateColumn()
  savedAt!: Date;
}
