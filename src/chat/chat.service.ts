import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateChatRequestDto } from './dto/create-chat-request.dto';
import { RespondChatRequestDto } from './dto/respond-chat-request.dto';
import { AddGroupMemberDto } from './dto/add-group-member.dto';
import { CreateGroupDto } from './dto/create-group.dto';
import { RespondGroupInvitationDto } from './dto/respond-group-invitation.dto';
import { ChatRequest } from './entities/chat-request.entity';
import { SavedChat } from './entities/saved-chat.entity';
import { GroupChat } from './entities/group-chat.entity';
import { GroupChatMember } from './entities/group-chat-member.entity';
import { GroupChatInvitation } from './entities/group-chat-invitation.entity';
import { ChatRequestStatus } from './enums/chat-request-status.enum';
import { GroupMemberRole } from './enums/group-member-role.enum';
import { GroupInvitationStatus } from './enums/group-invitation-status.enum';
import { DrawGateway } from '../realtime/draw.gateway';
import { UsersService } from '../users/users.service';
import { UserMode } from '../users/enums/user-mode.enum';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatRequest)
    private readonly chatRequestRepository: Repository<ChatRequest>,
    @InjectRepository(SavedChat)
    private readonly savedChatsRepository: Repository<SavedChat>,
    @InjectRepository(GroupChat)
    private readonly groupChatRepository: Repository<GroupChat>,
    @InjectRepository(GroupChatMember)
    private readonly groupChatMemberRepository: Repository<GroupChatMember>,
    @InjectRepository(GroupChatInvitation)
    private readonly groupChatInvitationRepository: Repository<GroupChatInvitation>,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => DrawGateway))
    private readonly drawGateway: DrawGateway,
    private readonly notificationsService: NotificationsService,
  ) {}

  async createRequest(
    fromUserId: string,
    dto: CreateChatRequestDto,
  ): Promise<ChatRequest | null> {
    const fromUser = await this.usersService.findById(fromUserId);
    if (!fromUser) {
      throw new NotFoundException('User not found');
    }

    const toUser = await this.usersService.findByDisplayName(dto.toDisplayName);

    if (!toUser) {
      return null;
    }

    if (toUser.id === fromUser.id) {
      throw new BadRequestException('You cannot chat with yourself');
    }

    const blocked = await this.usersService.isBlocked(fromUser.id, toUser.id);
    if (blocked) {
      throw new ForbiddenException(
        'You cannot send a chat request to this user',
      );
    }

    if (toUser.mode !== UserMode.PUBLIC && !toUser.appearInSearches) {
      throw new ForbiddenException('This user is not accepting chat requests');
    }

    const duplicate = await this.chatRequestRepository.findOne({
      where: {
        fromUserId: fromUser.id,
        toUserId: toUser.id,
        status: ChatRequestStatus.PENDING,
      },
    });
    if (duplicate) {
      throw new BadRequestException(
        'You already have a pending request to this user',
      );
    }

    const request = this.chatRequestRepository.create({
      fromUserId: fromUser.id,
      toUserId: toUser.id,
      status: ChatRequestStatus.PENDING,
    });

    const savedRequest = await this.chatRequestRepository.save(request);

    this.drawGateway.notifyChatRequested(toUser.id, {
      requestId: savedRequest.id,
      fromUser: {
        id: fromUser.id,
        displayName: fromUser.displayName,
      },
      message: `${fromUser.displayName} wants to chat. Accept?`,
    });

    void this.notificationsService.sendChatRequestPush(toUser.id, {
      requestId: savedRequest.id,
      senderUserId: fromUser.id,
      senderName: fromUser.displayName,
      messageId: `req-${randomUUID()}`,
    });

    return savedRequest;
  }

  async getSentRequests(userId: string): Promise<ChatRequest[]> {
    return this.chatRequestRepository.find({
      where: { fromUserId: userId },
      order: { createdAt: 'DESC' },
    });
  }

  async getReceivedRequests(userId: string): Promise<ChatRequest[]> {
    return this.chatRequestRepository.find({
      where: { toUserId: userId },
      order: { createdAt: 'DESC' },
    });
  }

  async respondToRequest(
    requestId: string,
    responderUserId: string,
    dto: RespondChatRequestDto,
  ): Promise<{ request: ChatRequest; roomId: string | null } | null> {
    const request = await this.chatRequestRepository.findOne({
      where: { id: requestId },
    });

    if (!request) {
      return null;
    }

    if (request.toUserId !== responderUserId) {
      throw new ForbiddenException('Only the recipient can respond');
    }

    if (request.status !== ChatRequestStatus.PENDING) {
      throw new BadRequestException('Chat request is already resolved');
    }

    if (dto.accept) {
      const blocked = await this.usersService.isBlocked(
        request.fromUserId,
        request.toUserId,
      );
      if (blocked) {
        // remove the chat request
        await this.chatRequestRepository.remove(request);
        throw new ForbiddenException('Can not find user.');
      }
    }

    request.status = dto.accept
      ? ChatRequestStatus.ACCEPTED
      : ChatRequestStatus.REJECTED;

    const savedRequest = await this.chatRequestRepository.save(request);
    const roomId = dto.accept ? this.buildRoomId(savedRequest.id) : null;

    this.drawGateway.notifyChatResponse(savedRequest.fromUserId, {
      requestId: savedRequest.id,
      accepted: dto.accept,
      roomId,
      responderUserId: savedRequest.toUserId,
    });

    this.drawGateway.notifyChatResponse(savedRequest.toUserId, {
      requestId: savedRequest.id,
      accepted: dto.accept,
      roomId,
      requesterUserId: savedRequest.fromUserId,
    });

    return { request: savedRequest, roomId };
  }

  async cancelRequest(requestId: string, userId: string): Promise<boolean> {
    const request = await this.chatRequestRepository.findOne({
      where: { id: requestId },
    });

    if (!request) {
      return false;
    }

    if (request.fromUserId !== userId) {
      throw new ForbiddenException('Only the sender can cancel this request');
    }

    if (request.status !== ChatRequestStatus.PENDING) {
      throw new BadRequestException('Only pending requests can be cancelled');
    }

    await this.chatRequestRepository.remove(request);
    return true;
  }

  async getAcceptedRoomForUser(
    requestId: string,
    userId: string,
  ): Promise<string | null> {
    const request = await this.chatRequestRepository.findOne({
      where: { id: requestId },
    });

    if (!request) {
      return null;
    }

    if (request.fromUserId !== userId && request.toUserId !== userId) {
      throw new ForbiddenException('You are not part of this chat request');
    }

    if (request.status !== ChatRequestStatus.ACCEPTED) {
      throw new ForbiddenException('Chat request is not accepted');
    }

    const blocked = await this.usersService.isBlocked(
      request.fromUserId,
      request.toUserId,
    );
    if (blocked) {
      // remove the chat request
      await this.chatRequestRepository.remove(request);
      throw new ForbiddenException('Can not find user.');
    }

    return this.buildRoomId(request.id);
  }

  buildRoomId(requestId: string): string {
    return `chat:${requestId}`;
  }

  /**
   * Returns the userId of the other participant in an accepted chat request.
   * Returns null if the request doesn't exist or userId is not a participant.
   */
  async getPeerUserId(
    requestId: string,
    userId: string,
  ): Promise<string | null> {
    const request = await this.chatRequestRepository.findOne({
      where: { id: requestId },
    });

    if (!request) return null;
    if (request.fromUserId !== userId && request.toUserId !== userId)
      return null;

    return request.fromUserId === userId
      ? request.toUserId
      : request.fromUserId;
  }

  async saveChat(requestId: string, userId: string): Promise<SavedChat | null> {
    const request = await this.chatRequestRepository.findOne({
      where: { id: requestId },
    });

    if (!request) {
      return null;
    }

    if (request.fromUserId !== userId && request.toUserId !== userId) {
      throw new ForbiddenException('You are not part of this chat');
    }

    if (request.status !== ChatRequestStatus.ACCEPTED) {
      throw new BadRequestException('Only accepted chats can be saved');
    }

    const existing = await this.savedChatsRepository.findOne({
      where: { chatRequestId: requestId, savedByUserId: userId },
    });
    if (existing) {
      return existing;
    }

    const saved = this.savedChatsRepository.create({
      chatRequestId: requestId,
      savedByUserId: userId,
    });
    return this.savedChatsRepository.save(saved);
  }

  async getSavedChats(userId: string): Promise<SavedChat[]> {
    return this.savedChatsRepository.find({
      where: { savedByUserId: userId },
      order: { savedAt: 'DESC' },
    });
  }

  async deleteSavedChat(savedChatId: string, userId: string): Promise<boolean> {
    const saved = await this.savedChatsRepository.findOne({
      where: { id: savedChatId },
    });

    if (!saved) {
      return false;
    }

    if (saved.savedByUserId !== userId) {
      throw new ForbiddenException('You can only delete your own saved chats');
    }

    await this.savedChatsRepository.remove(saved);
    return true;
  }

  async removeAcceptedChat(
    requestId: string,
    userId: string,
  ): Promise<boolean> {
    const request = await this.chatRequestRepository.findOne({
      where: { id: requestId },
    });

    if (!request) {
      return false;
    }

    if (request.fromUserId !== userId && request.toUserId !== userId) {
      throw new ForbiddenException('You are not part of this chat');
    }

    if (request.status !== ChatRequestStatus.ACCEPTED) {
      throw new BadRequestException('Only accepted chats can be removed');
    }

    // Force close the drawing room before deleting the chat request
    const roomId = this.buildRoomId(request.id);
    await this.drawGateway.forceCloseRoom(roomId);

    await this.chatRequestRepository.remove(request);
    return true;
  }

  /**
   * Close any active drawing rooms between two users (e.g., when one blocks the other).
   * Used by UsersService when blocking or deleting accounts.
   */
  async closeRoomsBetweenUsers(
    userId1: string,
    userId2: string,
  ): Promise<void> {
    const activeChats = await this.chatRequestRepository
      .createQueryBuilder('cr')
      .where('cr.status = :status', { status: ChatRequestStatus.ACCEPTED })
      .andWhere(
        '((cr.fromUserId = :userId1 AND cr.toUserId = :userId2) OR (cr.fromUserId = :userId2 AND cr.toUserId = :userId1))',
        { userId1, userId2 },
      )
      .getMany();

    for (const chat of activeChats) {
      const roomId = this.buildRoomId(chat.id);
      await this.drawGateway.forceCloseRoom(roomId);
    }
  }

  /**
   * Close all active drawing rooms for a user (e.g., when account is deleted).
   */
  async closeAllRoomsForUser(userId: string): Promise<void> {
    const activeChats = await this.chatRequestRepository
      .createQueryBuilder('cr')
      .where('cr.status = :status', { status: ChatRequestStatus.ACCEPTED })
      .andWhere('(cr.fromUserId = :userId OR cr.toUserId = :userId)', {
        userId,
      })
      .getMany();

    for (const chat of activeChats) {
      const roomId = this.buildRoomId(chat.id);
      await this.drawGateway.forceCloseRoom(roomId);
    }
  }

  // ── Group chat ───────────────────────────────────────────────────────────

  async createGroup(
    creatorId: string,
    dto: CreateGroupDto,
  ): Promise<GroupChat> {
    const group = this.groupChatRepository.create({
      name: dto.name,
      createdByUserId: creatorId,
    });
    const savedGroup = await this.groupChatRepository.save(group);

    const ownerMember = this.groupChatMemberRepository.create({
      groupChatId: savedGroup.id,
      userId: creatorId,
      role: GroupMemberRole.OWNER,
    });
    await this.groupChatMemberRepository.save(ownerMember);

    return this.getGroupById(savedGroup.id) as Promise<GroupChat>;
  }

  async inviteMember(
    groupId: string,
    requesterId: string,
    dto: AddGroupMemberDto,
  ): Promise<GroupChatInvitation> {
    const group = await this.getGroupById(groupId);
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const requesterMembership = group.members.find(
      (m) => m.userId === requesterId,
    );
    if (!requesterMembership) {
      throw new ForbiddenException('You are not a member of this group');
    }
    if (requesterMembership.role !== GroupMemberRole.OWNER) {
      throw new ForbiddenException('Only the group owner can invite members');
    }

    const targetUser = await this.usersService.findByDisplayName(
      dto.displayName,
    );
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    const alreadyMember = group.members.some((m) => m.userId === targetUser.id);
    if (alreadyMember) {
      throw new BadRequestException('User is already a member of this group');
    }

    const blocked = await this.usersService.isBlocked(
      requesterId,
      targetUser.id,
    );
    if (blocked) {
      throw new ForbiddenException('Cannot invite this user');
    }

    const existingInvite = await this.groupChatInvitationRepository.findOne({
      where: {
        groupChatId: groupId,
        inviteeUserId: targetUser.id,
        status: GroupInvitationStatus.PENDING,
      },
    });
    if (existingInvite) {
      throw new BadRequestException(
        'A pending invitation already exists for this user',
      );
    }

    const invitation = this.groupChatInvitationRepository.create({
      groupChatId: groupId,
      inviterUserId: requesterId,
      inviteeUserId: targetUser.id,
      status: GroupInvitationStatus.PENDING,
    });
    const savedInvitation =
      await this.groupChatInvitationRepository.save(invitation);

    const requester = await this.usersService.findById(requesterId);

    // Notify the invitee via socket
    this.drawGateway.notifyGroupInvite(targetUser.id, {
      invitationId: savedInvitation.id,
      groupId,
      groupName: group.name,
      inviterUserId: requesterId,
      inviterName: requester?.displayName ?? 'Someone',
    });

    // Send push notification to the invitee
    void this.notificationsService.sendGroupInvitePush(targetUser.id, {
      invitationId: savedInvitation.id,
      groupId,
      groupName: group.name,
      inviterName: requester?.displayName ?? 'Someone',
      messageId: `grp-inv-${savedInvitation.id}`,
    });

    return savedInvitation;
  }

  async respondToGroupInvitation(
    invitationId: string,
    userId: string,
    dto: RespondGroupInvitationDto,
  ): Promise<GroupChatInvitation> {
    const invitation = await this.groupChatInvitationRepository.findOne({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.inviteeUserId !== userId) {
      throw new ForbiddenException('Only the invitee can respond');
    }

    if (invitation.status !== GroupInvitationStatus.PENDING) {
      throw new BadRequestException('Invitation has already been responded to');
    }

    invitation.status = dto.accept
      ? GroupInvitationStatus.ACCEPTED
      : GroupInvitationStatus.REJECTED;
    await this.groupChatInvitationRepository.save(invitation);

    if (dto.accept) {
      const group = await this.getGroupById(invitation.groupChatId);
      if (!group) {
        throw new NotFoundException('Group no longer exists');
      }

      const alreadyMember = group.members.some((m) => m.userId === userId);
      if (!alreadyMember) {
        const member = this.groupChatMemberRepository.create({
          groupChatId: invitation.groupChatId,
          userId,
          role: GroupMemberRole.MEMBER,
        });
        await this.groupChatMemberRepository.save(member);
      }

      // Notify the inviter that the invitation was accepted
      const invitee = await this.usersService.findById(userId);
      this.drawGateway.notifyGroupInviteResponse(invitation.inviterUserId, {
        invitationId,
        groupId: invitation.groupChatId,
        groupName: group.name,
        inviteeUserId: userId,
        inviteeName: invitee?.displayName ?? 'Someone',
        accepted: true,
      });
    } else {
      // Notify the inviter that the invitation was rejected
      const group = await this.getGroupById(invitation.groupChatId);
      const invitee = await this.usersService.findById(userId);
      this.drawGateway.notifyGroupInviteResponse(invitation.inviterUserId, {
        invitationId,
        groupId: invitation.groupChatId,
        groupName: group?.name ?? '',
        inviteeUserId: userId,
        inviteeName: invitee?.displayName ?? 'Someone',
        accepted: false,
      });
    }

    return invitation;
  }

  async getPendingGroupInvitations(
    userId: string,
  ): Promise<GroupChatInvitation[]> {
    return this.groupChatInvitationRepository.find({
      where: { inviteeUserId: userId, status: GroupInvitationStatus.PENDING },
      order: { createdAt: 'DESC' },
    });
  }

  async removeMember(
    groupId: string,
    requesterId: string,
    targetUserId: string,
  ): Promise<void> {
    const group = await this.getGroupById(groupId);
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const requesterMembership = group.members.find(
      (m) => m.userId === requesterId,
    );
    if (!requesterMembership) {
      throw new ForbiddenException('You are not a member of this group');
    }

    // Owner can remove anyone; a member can only remove themselves
    if (
      requesterMembership.role !== GroupMemberRole.OWNER &&
      requesterId !== targetUserId
    ) {
      throw new ForbiddenException('Only the group owner can remove members');
    }

    if (targetUserId === group.createdByUserId) {
      throw new BadRequestException('The group owner cannot be removed');
    }

    const membership = group.members.find((m) => m.userId === targetUserId);
    if (!membership) {
      throw new NotFoundException('User is not a member of this group');
    }

    await this.groupChatMemberRepository.remove(membership);

    // Force the removed user's socket out of the room
    const roomId = this.buildGroupRoomId(groupId);
    await this.drawGateway.forceRemoveUserFromRoom(targetUserId, roomId);
  }

  async deleteGroup(groupId: string, requesterId: string): Promise<void> {
    const group = await this.getGroupById(groupId);
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    if (group.createdByUserId !== requesterId) {
      throw new ForbiddenException('Only the group owner can delete the group');
    }

    const roomId = this.buildGroupRoomId(groupId);
    await this.drawGateway.notifyGroupDeleted(groupId, roomId);

    await this.groupChatRepository.remove(group);
  }

  async getUserGroups(userId: string): Promise<GroupChat[]> {
    const memberships = await this.groupChatMemberRepository.find({
      where: { userId },
    });
    if (memberships.length === 0) return [];

    const groupIds = memberships.map((m) => m.groupChatId);
    return this.groupChatRepository
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.members', 'members')
      .leftJoinAndSelect('members.user', 'user')
      .leftJoinAndSelect('g.createdBy', 'createdBy')
      .where('g.id IN (:...groupIds)', { groupIds })
      .orderBy('g.createdAt', 'DESC')
      .getMany();
  }

  async getGroupById(groupId: string): Promise<GroupChat | null> {
    return this.groupChatRepository
      .createQueryBuilder('g')
      .leftJoinAndSelect('g.members', 'members')
      .leftJoinAndSelect('members.user', 'user')
      .leftJoinAndSelect('g.createdBy', 'createdBy')
      .where('g.id = :groupId', { groupId })
      .getOne();
  }

  async getGroupRoomForMember(
    groupId: string,
    userId: string,
  ): Promise<string> {
    const group = await this.getGroupById(groupId);
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const isMember = group.members.some((m) => m.userId === userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this group');
    }

    return this.buildGroupRoomId(groupId);
  }

  buildGroupRoomId(groupId: string): string {
    return `group:${groupId}`;
  }
}
