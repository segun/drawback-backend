import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly redis: Redis | null;

  /** Fallback when REDIS_URL is absent — single-instance only */
  private readonly mem = new Map<
    string,
    { value: string; expiresAt: number }
  >();

  constructor(private readonly config: ConfigService) {
    const redisUrl = config.get<string>('REDIS_URL');
    if (redisUrl) {
      this.redis = new Redis(redisUrl, { lazyConnect: true });
      this.redis.on('error', (err: Error) =>
        this.logger.warn(`Redis cache error: ${err.message}`),
      );
    } else {
      this.redis = null;
      this.logger.warn(
        'REDIS_URL not set — using in-memory cache (not suitable for multi-instance)',
      );
    }
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.redis) {
      try {
        const raw = await this.redis.get(key);
        return raw ? (JSON.parse(raw) as T) : null;
      } catch {
        // Redis unavailable — fall through to in-memory
      }
    }

    const entry = this.mem.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.mem.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
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
    if (this.redis) {
      this.logger.debug(`Cache set: ${key} (TTL ${ttlSeconds}s)`);
      try {
        await this.redis.set(key, serialised, 'EX', ttlSeconds);
        return;
      } catch {
        // Redis unavailable — fall through to in-memory
      }
    }
    this.mem.set(key, {
      value: serialised,
      expiresAt: Date.now() + ttlSeconds * 1_000,
    });
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    if (this.redis) {
      this.logger.debug(`Cache del: ${keys.join(', ')}`);
      try {
        await this.redis.del(...keys);
        return;
      } catch {
        // Redis unavailable — fall through to in-memory
      }
    }
    keys.forEach((k) => this.mem.delete(k));
  }

  /**
   * Deletes all keys matching a glob pattern (e.g. `public_users:*`).
   * Uses SCAN on Redis to avoid blocking; regex match on the in-memory store.
   */
  async delByPattern(pattern: string): Promise<void> {
    if (this.redis) {
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
        return;
      } catch {
        // Redis unavailable — fall through to in-memory
      }
    }

    const regex = new RegExp(
      '^' +
        pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') +
        '$',
    );
    for (const key of this.mem.keys()) {
      if (regex.test(key)) this.mem.delete(key);
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }
}
