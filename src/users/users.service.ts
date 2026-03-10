import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ChatService } from '../chat/chat.service';
import { StorageService } from '../storage/storage.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { DiscoveryUserResponseDto } from './dto/discovery-user-response.dto';
import { UserBlock } from './entities/user-block.entity';
import { User } from './entities/user.entity';
import { UserMode } from './enums/user-mode.enum';
import { ChatRequest } from '../chat/entities/chat-request.entity';
import { ChatRequestStatus } from '../chat/enums/chat-request-status.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserBlock)
    private readonly blocksRepository: Repository<UserBlock>,
    @InjectRepository(ChatRequest)
    private readonly chatRequestRepository: Repository<ChatRequest>,
    @Inject(forwardRef(() => ChatService))
    private readonly chatService: ChatService,
    private readonly storage: StorageService,
  ) {}

  async findById(id: string): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByDisplayName(displayName: string): Promise<User | null> {
    return this.usersRepository.findOne({
      where: { displayName: displayName.toLowerCase() },
    });
  }

  async isDisplayNameAvailable(
    displayName: string,
    currentUserId?: string,
  ): Promise<{ available: boolean }> {
    const normalised = displayName.toLowerCase();
    const existing = await this.usersRepository.findOne({
      where: { displayName: normalised },
    });
    // Available if nobody has it, or the only holder is the requesting user themselves
    const available =
      !existing || (!!currentUserId && existing.id === currentUserId);
    return { available };
  }

  async updateDisplayName(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<User> {
    const user = await this.findById(userId);
    const normalised = dto.displayName.toLowerCase();

    const taken = await this.usersRepository.findOne({
      where: { displayName: normalised },
    });
    if (taken && taken.id !== userId) {
      throw new ConflictException('Display name is already taken');
    }

    user.displayName = normalised;
    return this.usersRepository.save(user);
  }

  async setMode(userId: string, mode: UserMode): Promise<User> {
    const user = await this.findById(userId);
    user.mode = mode;
    return this.usersRepository.save(user);
  }

  async deleteAccount(userId: string): Promise<void> {
    const user = await this.findById(userId);

    // Close all active drawing rooms for this user
    await this.chatService.closeAllRoomsForUser(userId);

    await this.usersRepository.remove(user);
  }

  async listPublic(currentUserId: string): Promise<User[]> {
    return this.usersRepository
      .createQueryBuilder('user')
      .where('user.mode = :mode', { mode: UserMode.PUBLIC })
      .andWhere('user.id != :currentUserId', { currentUserId })
      .andWhere(
        `user.id NOT IN (
          SELECT ub.blockedId FROM user_blocks ub WHERE ub.blockerId = :currentUserId
          UNION
          SELECT ub.blockerId FROM user_blocks ub WHERE ub.blockedId = :currentUserId
        )`,
        { currentUserId },
      )
      .orderBy('user.createdAt', 'DESC')
      .getMany();
  }

  async searchByDisplayName(
    query: string,
    currentUserId: string,
  ): Promise<User[]> {
    const normalised = query.toLowerCase().replace(/^@/, '');
    return this.usersRepository
      .createQueryBuilder('user')
      .where('user.displayName LIKE :query', { query: `@${normalised}%` })
      .andWhere('user.id != :currentUserId', { currentUserId })
      .andWhere(
        `user.id NOT IN (
          SELECT ub.blockedId FROM user_blocks ub WHERE ub.blockerId = :currentUserId
          UNION
          SELECT ub.blockerId FROM user_blocks ub WHERE ub.blockedId = :currentUserId
        )`,
        { currentUserId },
      )
      .andWhere(
        `(
          user.mode = :publicMode
          OR user.appearInSearches = TRUE
          OR EXISTS (
            SELECT 1 FROM chat_requests cr
            WHERE cr.status = :accepted
              AND (
                (cr.fromUserId = :currentUserId AND cr.toUserId = user.id)
                OR (cr.fromUserId = user.id AND cr.toUserId = :currentUserId)
              )
          )
        )`,
        { publicMode: UserMode.PUBLIC, accepted: ChatRequestStatus.ACCEPTED },
      )
      .orderBy('user.displayName', 'ASC')
      .getMany();
  }

  async setAppearInSearches(
    userId: string,
    appearInSearches: boolean,
  ): Promise<User> {
    const user = await this.findById(userId);
    user.appearInSearches = appearInSearches;
    return this.usersRepository.save(user);
  }

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    if (blockerId === blockedId) {
      throw new BadRequestException('You cannot block yourself');
    }

    await this.findById(blockedId); // ensure target exists

    const existing = await this.blocksRepository.findOne({
      where: { blockerId, blockedId },
    });
    if (existing) {
      return; // idempotent
    }

    // Create the block
    const block = this.blocksRepository.create({ blockerId, blockedId });
    await this.blocksRepository.save(block);

    // Close any active drawing rooms between these users
    await this.chatService.closeRoomsBetweenUsers(blockerId, blockedId);
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.blocksRepository.delete({ blockerId, blockedId });
  }

  async listBlocked(blockerId: string): Promise<User[]> {
    const blocks = await this.blocksRepository.find({
      where: { blockerId },
      relations: ['blocked'],
      order: { createdAt: 'DESC' },
    });
    return blocks.map((b) => b.blocked);
  }

  async isBlocked(userAId: string, userBId: string): Promise<boolean> {
    const count = await this.blocksRepository
      .createQueryBuilder('ub')
      .where(
        '(ub.blockerId = :userAId AND ub.blockedId = :userBId) OR (ub.blockerId = :userBId AND ub.blockedId = :userAId)',
        { userAId, userBId },
      )
      .getCount();
    return count > 0;
  }

  // ── Discovery Game ──────────────────────────────────────────────────────

  /**
   * Check if two users have an active chat request (PENDING or ACCEPTED).
   */
  private async hasActiveChatRequest(
    userAId: string,
    userBId: string,
  ): Promise<boolean> {
    const count = await this.chatRequestRepository
      .createQueryBuilder('cr')
      .where(
        '((cr.fromUserId = :userAId AND cr.toUserId = :userBId) OR (cr.fromUserId = :userBId AND cr.toUserId = :userAId))',
        { userAId, userBId },
      )
      .andWhere('cr.status IN (:...statuses)', {
        statuses: [ChatRequestStatus.PENDING, ChatRequestStatus.ACCEPTED],
      })
      .getCount();

    return count > 0;
  }

  async setDiscoveryGame(
    userId: string,
    appearInDiscoveryGame: boolean,
    base64Image?: string,
  ): Promise<User> {
    const user = await this.findById(userId);

    if (appearInDiscoveryGame) {
      // Enabling discovery game — require image
      if (!base64Image) {
        throw new BadRequestException(
          'base64Image is required when enabling discovery game',
        );
      }

      // Upload image to Cloudflare R2
      const imageUrl = await this.storage.uploadDiscoveryImage(
        userId,
        base64Image,
      );
      user.discoveryImageUrl = imageUrl;
      user.appearInDiscoveryGame = true;
    } else {
      // Disabling discovery game — delete image
      if (user.discoveryImageUrl) {
        await this.storage.deleteDiscoveryImage(userId);
      }
      user.discoveryImageUrl = null;
      user.appearInDiscoveryGame = false;
    }

    return this.usersRepository.save(user);
  }

  async getRandomDiscoveryUser(
    currentUser: User,
  ): Promise<DiscoveryUserResponseDto | null> {
    // Check if user has access to discovery feature
    if (!currentUser.hasDiscoveryAccess) {
      throw new ForbiddenException({
        error: 'DISCOVERY_LOCKED',
        message: 'Discovery requires premium access',
      });
    }

    // Query DB directly for a random discovery user, excluding current user
    // and users with whom there's already an active chat request
    const users = await this.usersRepository
      .createQueryBuilder('user')
      .select(['user.id', 'user.displayName', 'user.discoveryImageUrl'])
      .where('user.appearInDiscoveryGame = :enabled', { enabled: true })
      .andWhere('user.discoveryImageUrl IS NOT NULL')
      .andWhere('user.id != :excludeUserId', { excludeUserId: currentUser.id })
      .andWhere(
        `NOT EXISTS (
          SELECT 1 FROM chat_requests cr
          WHERE cr.status IN (:...statuses)
            AND (
              (cr.fromUserId = :currentUserId AND cr.toUserId = user.id)
              OR (cr.fromUserId = user.id AND cr.toUserId = :currentUserId)
            )
        )`,
        {
          statuses: [ChatRequestStatus.PENDING, ChatRequestStatus.ACCEPTED],
          currentUserId: currentUser.id,
        },
      )
      .orderBy('RAND()')
      .limit(1)
      .getMany();

    if (users.length === 0) {
      return null;
    }

    return {
      id: users[0].id,
      displayName: users[0].displayName,
      discoveryImageUrl: users[0].discoveryImageUrl!,
    };
  }
}
