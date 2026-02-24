import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UserBlock } from './entities/user-block.entity';
import { User } from './entities/user.entity';
import { UserMode } from './enums/user-mode.enum';
import { ChatRequestStatus } from '../chat/enums/chat-request-status.enum';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
    @InjectRepository(UserBlock)
    private readonly blocksRepository: Repository<UserBlock>,
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
}
