import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { GroupChat } from './group-chat.entity';
import { GroupInvitationStatus } from '../enums/group-invitation-status.enum';

@Entity('group_chat_invitations')
@Index('idx_gci_inviteeId_status', ['inviteeUserId', 'status'])
@Index('idx_gci_groupId_inviteeId', ['groupChatId', 'inviteeUserId'])
export class GroupChatInvitation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'uuid' })
  groupChatId!: string;

  @Column({ type: 'uuid' })
  inviterUserId!: string;

  @Column({ type: 'uuid' })
  inviteeUserId!: string;

  @ManyToOne(() => GroupChat, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'groupChatId' })
  groupChat!: GroupChat;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inviterUserId' })
  inviter!: User;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'inviteeUserId' })
  invitee!: User;

  @Column({
    type: 'enum',
    enum: GroupInvitationStatus,
    default: GroupInvitationStatus.PENDING,
  })
  status!: GroupInvitationStatus;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
