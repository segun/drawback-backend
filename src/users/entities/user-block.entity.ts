import {
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Column,
  Unique,
} from 'typeorm';
import { User } from './user.entity';

@Entity('user_blocks')
@Unique(['blockerId', 'blockedId'])
@Index('idx_user_blocks_blockedId', ['blockedId'])
export class UserBlock {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  blockerId!: string;

  @Column({ type: 'uuid' })
  blockedId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'blockerId' })
  blocker!: User;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'blockedId' })
  blocked!: User;

  @CreateDateColumn()
  createdAt!: Date;
}
