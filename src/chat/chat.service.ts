import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateChatRequestDto } from './dto/create-chat-request.dto';
import { RespondChatRequestDto } from './dto/respond-chat-request.dto';
import { ChatRequest } from './entities/chat-request.entity';
import { SavedChat } from './entities/saved-chat.entity';
import { ChatRequestStatus } from './enums/chat-request-status.enum';
import { DrawGateway } from '../realtime/draw.gateway';
import { UsersService } from '../users/users.service';
import { UserMode } from '../users/enums/user-mode.enum';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(ChatRequest)
    private readonly chatRequestRepository: Repository<ChatRequest>,
    @InjectRepository(SavedChat)
    private readonly savedChatsRepository: Repository<SavedChat>,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    @Inject(forwardRef(() => DrawGateway))
    private readonly drawGateway: DrawGateway,
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
}
