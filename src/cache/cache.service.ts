import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis;

  constructor(private readonly config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL');
    if (!redisUrl) {
      throw new Error(
        'REDIS_URL environment variable is required. ' +
          'Redis is mandatory for production deployments.',
      );
    }
    this.redis = new Redis(redisUrl, { lazyConnect: true });
    this.redis.on('error', (err: Error) =>
      this.logger.error(`Redis cache error: ${err.message}`),
    );
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn(
        `Redis get failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null; // Treat as cache miss, not fallback to in-memory
    }
  }

  /**
   * Like get(), but reconstructs the value as a class instance so that
   * class-transformer decorators (@Exclude etc.) apply on outbound HTTP
   * serialization. Uses ignoreDecorators:true for the plainToInstance call
   * so that @Exclude() fields (e.g. isActivated) are correctly populated
   * internally — they are still excluded from HTTP responses by
   * ClassSerializerInterceptor when it calls instanceToPlain.
   */
  async getInstance<T>(
    key: string,
    cls: new (...args: unknown[]) => T,
  ): Promise<T | null> {
    const plain = await this.get<object>(key);
    return plain
      ? plainToInstance(cls, plain, { ignoreDecorators: true })
      : null;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    const serialised = JSON.stringify(value);
    this.logger.debug(`Cache set: ${key} (TTL ${ttlSeconds}s)`);
    try {
      await this.redis.set(key, serialised, 'EX', ttlSeconds);
    } catch (err) {
      this.logger.warn(
        `Redis set failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Do not fall back to in-memory — cache write failure is logged but not fatal
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    this.logger.debug(`Cache del: ${keys.join(', ')}`);
    try {
      await this.redis.del(...keys);
    } catch (err) {
      this.logger.warn(
        `Redis del failed for keys ${keys.join(', ')}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Do not fall back to in-memory — cache deletion failure is logged but not fatal
    }
  }

  /**
   * Deletes all keys matching a glob pattern (e.g. `public_users:*`).
   * Uses SCAN on Redis to avoid blocking.
   */
  async delByPattern(pattern: string): Promise<void> {
    this.logger.debug(`Cache delByPattern: ${pattern}`);
    try {
      let cursor = '0';
      do {
        const [next, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length) await this.redis.del(...keys);
      } while (cursor !== '0');
    } catch (err) {
      this.logger.warn(
        `Redis delByPattern failed for pattern ${pattern}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Do not fall back to in-memory — cache deletion failure is logged but not fatal
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }
}
