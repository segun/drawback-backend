import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SessionEvent } from './entities/session-event.entity';
import { User } from '../users/entities/user.entity';
import { SessionEventType } from './enums/session-event-type.enum';
import { SessionEventFiltersDto } from './dto/session-event-filters.dto';

@Injectable()
export class SessionEventsService {
  private readonly logger = new Logger(SessionEventsService.name);

  constructor(
    @InjectRepository(SessionEvent)
    private readonly sessionEventRepository: Repository<SessionEvent>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async logEvent(
    userId: string,
    eventType: SessionEventType,
    ipAddress?: string,
    metadata?: Record<string, any>,
  ): Promise<void> {
    try {
      await this.sessionEventRepository.save({
        userId,
        eventType,
        ipAddress,
        metadata,
      });
    } catch (error) {
      this.logger.error(
        `Failed to log session event: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async findEvents(
    filters: SessionEventFiltersDto,
    limit = 100,
    offset = 0,
  ): Promise<{ events: SessionEvent[]; total: number }> {
    const queryBuilder = this.sessionEventRepository
      .createQueryBuilder('event')
      .leftJoinAndSelect('event.user', 'user')
      .orderBy('event.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    // Resolve user by displayName or email
    if (filters.user) {
      const user = await this.userRepository.findOne({
        where: [
          { displayName: filters.user.toLowerCase() },
          { email: filters.user.toLowerCase() },
        ],
      });
      if (user) {
        queryBuilder.andWhere('event.userId = :userId', {
          userId: user.id,
        });
      } else {
        // Return empty result if user not found
        return { events: [], total: 0 };
      }
    }

    if (filters.eventType) {
      queryBuilder.andWhere('event.eventType = :eventType', {
        eventType: filters.eventType,
      });
    }

    if (filters.socketId) {
      queryBuilder.andWhere(
        "JSON_EXTRACT(event.metadata, '$.socketId') = :socketId",
        { socketId: filters.socketId },
      );
    }

    if (filters.roomId) {
      queryBuilder.andWhere(
        "JSON_EXTRACT(event.metadata, '$.roomId') = :roomId",
        { roomId: filters.roomId },
      );
    }

    if (filters.requestId) {
      queryBuilder.andWhere(
        "JSON_EXTRACT(event.metadata, '$.requestId') = :requestId",
        { requestId: filters.requestId },
      );
    }

    if (filters.startDate) {
      queryBuilder.andWhere('event.createdAt >= :startDate', {
        startDate: new Date(filters.startDate),
      });
    }

    if (filters.endDate) {
      queryBuilder.andWhere('event.createdAt <= :endDate', {
        endDate: new Date(filters.endDate),
      });
    }

    const [events, total] = await queryBuilder.getManyAndCount();

    return { events, total };
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupOldEvents(): Promise<void> {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    try {
      const result = await this.sessionEventRepository.delete({
        createdAt: LessThan(thirtyDaysAgo),
      });

      this.logger.log(
        `Deleted ${result.affected ?? 0} session events older than 30 days`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to cleanup old session events: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  async getEventStats(): Promise<{
    total: number;
    last24Hours: number;
    last7Days: number;
    byType: Record<SessionEventType, number>;
  }> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [total, last24Hours, last7Days] = await Promise.all([
      this.sessionEventRepository.count(),
      this.sessionEventRepository.count({
        where: { createdAt: LessThan(oneDayAgo) },
      }),
      this.sessionEventRepository.count({
        where: { createdAt: LessThan(sevenDaysAgo) },
      }),
    ]);

    const byType: Record<SessionEventType, number> = {
      [SessionEventType.CONNECT]: 0,
      [SessionEventType.DISCONNECT]: 0,
      [SessionEventType.CHAT_JOINED]: 0,
      [SessionEventType.CHAT_LEFT]: 0,
    };

    for (const type of Object.values(SessionEventType)) {
      byType[type] = await this.sessionEventRepository.count({
        where: { eventType: type },
      });
    }

    return { total, last24Hours, last7Days, byType };
  }
}
