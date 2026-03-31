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
import { GroupChat } from './group-chat.entity';
import { GroupMemberRole } from '../enums/group-member-role.enum';

@Entity('group_chat_members')
@Unique(['groupChatId', 'userId'])
export class GroupChatMember {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  groupChatId!: string;

  @Column({ type: 'uuid' })
  userId!: string;

  @ManyToOne(() => GroupChat, (g) => g.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupChatId' })
  groupChat!: GroupChat;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user!: User;

  @Column({
    type: 'enum',
    enum: GroupMemberRole,
    default: GroupMemberRole.MEMBER,
  })
  role!: GroupMemberRole;

  @CreateDateColumn()
  joinedAt!: Date;
}
