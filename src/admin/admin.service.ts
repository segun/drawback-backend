import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { User } from '../users/entities/user.entity';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { MailService } from '../mail/mail.service';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { UserFilterQueryDto } from './dto/user-filter-query.dto';
import { SearchField, UserSearchQueryDto } from './dto/user-search-query.dto';
import { BanUsersDto } from './dto/ban-users.dto';
import { AdminAction } from './enums/admin-action.enum';
import { AuthService } from '../auth/auth.service';

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(AdminAuditLog)
    private readonly auditLogRepository: Repository<AdminAuditLog>,
    private readonly mailService: MailService,
  ) {}

  async listUsers(
    dto: PaginationQueryDto,
  ): Promise<{ data: User[]; total: number; page: number; limit: number }> {
    const skip = (dto.page - 1) * dto.limit;

    const [data, total] = await this.userRepository.findAndCount({
      skip,
      take: dto.limit,
      order: { createdAt: 'DESC' },
    });

    return { data, total, page: dto.page, limit: dto.limit };
  }

  async filterUsers(
    dto: UserFilterQueryDto,
  ): Promise<{ data: User[]; total: number; page: number; limit: number }> {
    const skip = (dto.page - 1) * dto.limit;
    const qb = this.userRepository.createQueryBuilder('user');

    if (dto.mode !== undefined) {
      qb.andWhere('user.mode = :mode', { mode: dto.mode });
    }
    if (dto.appearInSearches !== undefined) {
      qb.andWhere('user.appearInSearches = :appearInSearches', {
        appearInSearches: dto.appearInSearches,
      });
    }
    if (dto.appearInDiscoveryGame !== undefined) {
      qb.andWhere('user.appearInDiscoveryGame = :appearInDiscoveryGame', {
        appearInDiscoveryGame: dto.appearInDiscoveryGame,
      });
    }
    if (dto.isBlocked !== undefined) {
      qb.andWhere('user.isBlocked = :isBlocked', {
        isBlocked: dto.isBlocked,
      });
    }
    if (dto.isActivated !== undefined) {
      qb.andWhere('user.isActivated = :isActivated', {
        isActivated: dto.isActivated,
      });
    }

    const [data, total] = await qb
      .skip(skip)
      .take(dto.limit)
      .orderBy('user.createdAt', 'DESC')
      .getManyAndCount();

    return { data, total, page: dto.page, limit: dto.limit };
  }

  async searchUsers(
    dto: UserSearchQueryDto,
  ): Promise<{ data: User[]; total: number; page: number; limit: number }> {
    const skip = (dto.page - 1) * dto.limit;
    const qb = this.userRepository.createQueryBuilder('user');

    if (dto.searchField === SearchField.DISPLAY_NAME) {
      const normalized = dto.q.toLowerCase();
      qb.where('user.displayName LIKE :q', { q: `${normalized}%` });
    } else if (dto.searchField === SearchField.EMAIL) {
      qb.where('user.email LIKE :q', { q: `%${dto.q}%` });
    }

    const [data, total] = await qb
      .skip(skip)
      .take(dto.limit)
      .orderBy('user.createdAt', 'DESC')
      .getManyAndCount();

    return { data, total, page: dto.page, limit: dto.limit };
  }

  async getUserDetails(userId: string): Promise<User> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async banUsers(
    adminUser: User,
    dto: BanUsersDto,
  ): Promise<{ banned: number }> {
    const result = await this.userRepository.update(
      { id: In(dto.userIds) },
      {
        isBlocked: true,
        blockedAt: new Date(),
        blockedReason: dto.reason || null,
      },
    );

    // Write audit log
    await this.auditLogRepository.save({
      adminId: adminUser.id,
      action: AdminAction.BAN_USER,
      targetUserIds: dto.userIds,
      metadata: dto.reason ? { reason: dto.reason } : null,
    });

    return { banned: result.affected || 0 };
  }

  async unbanUsers(
    adminUser: User,
    userIds: string[],
  ): Promise<{ unbanned: number }> {
    const result = await this.userRepository.update(
      { id: In(userIds) },
      {
        isBlocked: false,
        blockedAt: null,
        blockedReason: null,
      },
    );

    // Write audit log
    await this.auditLogRepository.save({
      adminId: adminUser.id,
      action: AdminAction.UNBAN_USER,
      targetUserIds: userIds,
      metadata: null,
    });

    return { unbanned: result.affected || 0 };
  }

  async resetUserPasswords(
    adminUser: User,
    userIds: string[],
  ): Promise<{ emailsSent: number; failed: string[] }> {
    const users = await this.userRepository.find({
      where: { id: In(userIds) },
    });

    let emailsSent = 0;
    const failed: string[] = [];

    for (const user of users) {
      try {
        const token = randomUUID();
        const expiryMs = AuthService.RESET_TOKEN_TTL_HOURS * 60 * 60 * 1000;
        user.resetToken = token;
        user.resetTokenExpiry = new Date(Date.now() + expiryMs);
        await this.userRepository.save(user);

        await this.mailService.sendPasswordResetEmail(
          user.email,
          token,
          user.displayName,
          AuthService.RESET_TOKEN_TTL_HOURS,
        );
        emailsSent++;
      } catch (error) {
        failed.push(user.id);
      }
    }

    // Write audit log
    await this.auditLogRepository.save({
      adminId: adminUser.id,
      action: AdminAction.RESET_PASSWORD,
      targetUserIds: userIds,
      metadata: failed.length > 0 ? { failedUserIds: failed } : null,
    });

    return { emailsSent, failed };
  }
}
