import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { User } from '../users/entities/user.entity';
import { AdminAuditLog } from './entities/admin-audit-log.entity';
import { MailService } from '../mail/mail.service';
import { DrawGateway } from '../realtime/draw.gateway';
import { PaginationQueryDto } from './dto/pagination-query.dto';
import { UserFilterQueryDto } from './dto/user-filter-query.dto';
import { SearchField, UserSearchQueryDto } from './dto/user-search-query.dto';
import { BanUsersDto } from './dto/ban-users.dto';
import { SocketInfoDto } from './dto/socket-info.dto';
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
    private readonly drawGateway: DrawGateway,
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
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
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

  async getActiveSockets(dto: PaginationQueryDto): Promise<{
    data: SocketInfoDto[];
    total: number;
    page: number;
    limit: number;
  }> {
    const allSockets = await this.drawGateway.getActiveSocketsMetadata();

    // Sort by connectedAt descending (most recent first)
    allSockets.sort(
      (a, b) =>
        new Date(b.connectedAt).getTime() - new Date(a.connectedAt).getTime(),
    );

    // Apply pagination
    const skip = (dto.page - 1) * dto.limit;
    const paginatedSockets = allSockets.slice(skip, skip + dto.limit);

    // Fetch user details for each socket
    const userIds = paginatedSockets.map((s) => s.userId);
    const users = await this.userRepository.find({
      where: { id: In(userIds) },
      select: ['id', 'email', 'displayName'],
    });

    const userMap = new Map(users.map((u) => [u.id, u]));

    const data: SocketInfoDto[] = paginatedSockets.map((socket) => {
      const user = userMap.get(socket.userId);
      return {
        userId: socket.userId,
        userEmail: user?.email || 'unknown',
        userDisplayName: user?.displayName || 'unknown',
        socketId: socket.socketId,
        connectedAt: socket.connectedAt,
        currentRoom: socket.currentRoom || null,
        ipAddress: socket.ipAddress,
        userAgent: socket.userAgent,
      };
    });

    return {
      data,
      total: allSockets.length,
      page: dto.page,
      limit: dto.limit,
    };
  }

  async exportUsers(dto: UserFilterQueryDto): Promise<string> {
    // Use the same filtering logic as filterUsers but without pagination
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

    const users = await qb.orderBy('user.createdAt', 'DESC').getMany();

    // Build CSV manually
    const headers = [
      'id',
      'email',
      'displayName',
      'mode',
      'role',
      'isActivated',
      'isBlocked',
      'blockedAt',
      'blockedReason',
      'appearInSearches',
      'appearInDiscoveryGame',
      'hasDiscoveryAccess',
      'createdAt',
      'updatedAt',
    ];

    const rows: string[][] = users.map((user) => {
      const blockedAtStr = user.blockedAt
        ? (user.blockedAt as Date).toISOString()
        : '';
      return [
        user.id,
        user.email,
        user.displayName,
        user.mode,
        user.role,
        String(user.isActivated),
        String(user.isBlocked),
        blockedAtStr,
        user.blockedReason || '',
        String(user.appearInSearches),
        String(user.appearInDiscoveryGame),
        String(user.hasDiscoveryAccess),
        user.createdAt.toISOString(),
        user.updatedAt.toISOString(),
      ];
    });

    // Escape and quote CSV fields
    const escapeCsvField = (field: string): string => {
      if (field.includes(',') || field.includes('"') || field.includes('\n')) {
        return `"${field.replace(/"/g, '""')}"`;
      }
      return field;
    };

    const csvLines = [
      headers.join(','),
      ...rows.map((row) => row.map(escapeCsvField).join(',')),
    ];

    return csvLines.join('\n');
  }
}
