import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { plainToInstance } from 'class-transformer';
import { Repository } from 'typeorm';
import { CacheService } from '../cache/cache.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserBlock } from './entities/user-block.entity';
import { User } from './entities/user.entity';
import { UserMode } from './enums/user-mode.enum';
import { ChatRequestStatus } from '../chat/enums/chat-request-status.enum';

const TTL_USER = 3600;
const TTL_BLOCKED = 30;
const TTL_PUBLIC = 30;
const TTL_BLOCKED_LIST = 60;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserBlock)
    private readonly blocksRepository: Repository<UserBlock>,
    private readonly cache: CacheService,
  ) {}

  // ── Cache key helpers ───────────────────────────────────────────────────

  private userKey(id: string) {
    return `user:${id}`;
  }

  /** Canonical: sort IDs so (A,B) and (B,A) hit the same key */
  private blockedKey(userAId: string, userBId: string) {
    const [a, b] = [userAId, userBId].sort();
    return `blocked:${a}:${b}`;
  }

  private publicUsersKey(userId: string) {
    return `public_users:${userId}`;
  }

  private blockedListKey(userId: string) {
    return `blocked_list:${userId}`;
  }

  private async invalidateBlockCaches(
    blockerId: string,
    blockedId: string,
  ): Promise<void> {
    await this.cache.del(
      this.blockedKey(blockerId, blockedId),
      this.publicUsersKey(blockerId),
      this.publicUsersKey(blockedId),
      this.blockedListKey(blockerId),
    );
  }

  async findById(id: string): Promise<User> {
    const cached = await this.cache.getInstance(this.userKey(id), User);
    if (cached) return cached;

    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await this.cache.set(this.userKey(id), user, TTL_USER);
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
    const saved = await this.usersRepository.save(user);
    await this.cache.del(this.userKey(userId));
    return saved;
  }

  async setMode(userId: string, mode: UserMode): Promise<User> {
    const user = await this.findById(userId);
    user.mode = mode;
    const saved = await this.usersRepository.save(user);
    // Mode change must be visible immediately — bust user cache and every
    // public-user list (since this user's visibility changed for everyone).
    await Promise.all([
      this.cache.del(this.userKey(userId)),
      this.cache.delByPattern('public_users:*'),
    ]);
    return saved;
  }

  async deleteAccount(userId: string): Promise<void> {
    const user = await this.findById(userId);
    await this.usersRepository.remove(user);
    await this.cache.del(this.userKey(userId));
  }

  async listPublic(currentUserId: string): Promise<User[]> {
    const key = this.publicUsersKey(currentUserId);
    const cached = await this.cache.get<object[]>(key);
    if (cached) return cached.map((u) => plainToInstance(User, u));

    const users = await this.usersRepository
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

    await this.cache.set(key, users, TTL_PUBLIC);
    return users;
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

    const block = this.blocksRepository.create({ blockerId, blockedId });
    await this.blocksRepository.save(block);
    await this.invalidateBlockCaches(blockerId, blockedId);
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.blocksRepository.delete({ blockerId, blockedId });
    await this.invalidateBlockCaches(blockerId, blockedId);
  }

  async listBlocked(blockerId: string): Promise<User[]> {
    const key = this.blockedListKey(blockerId);
    const cached = await this.cache.get<object[]>(key);
    if (cached) return cached.map((u) => plainToInstance(User, u));

    const blocks = await this.blocksRepository.find({
      where: { blockerId },
      relations: ['blocked'],
      order: { createdAt: 'DESC' },
    });
    const users = blocks.map((b) => b.blocked);
    await this.cache.set(key, users, TTL_BLOCKED_LIST);
    return users;
  }

  async isBlocked(userAId: string, userBId: string): Promise<boolean> {
    const key = this.blockedKey(userAId, userBId);
    const cached = await this.cache.get<boolean>(key);
    if (cached !== null) return cached;

    const count = await this.blocksRepository
      .createQueryBuilder('ub')
      .where(
        '(ub.blockerId = :userAId AND ub.blockedId = :userBId) OR (ub.blockerId = :userBId AND ub.blockedId = :userAId)',
        { userAId, userBId },
      )
      .getCount();
    const result = count > 0;
    await this.cache.set(key, result, TTL_BLOCKED);
    return result;
  }
}
