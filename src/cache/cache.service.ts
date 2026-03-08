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

  // ── Redis List Operations ──────────────────────────────────────────────

  /**
   * Pop an item from the left (head) of a Redis list.
   * Returns null if the list is empty or doesn't exist.
   */
  async lpop<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.lpop(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      this.logger.warn(
        `Redis lpop failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Push one or more items to the right (tail) of a Redis list.
   * Items are JSON-serialized before pushing.
   */
  async rpush<T>(key: string, ...values: T[]): Promise<void> {
    if (!values.length) return;
    try {
      const serialised = values.map((v) => JSON.stringify(v));
      await this.redis.rpush(key, ...serialised);
    } catch (err) {
      this.logger.warn(
        `Redis rpush failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Remove elements from a list. Count determines behavior:
   * - count > 0: Remove elements from head to tail
   * - count < 0: Remove elements from tail to head
   * - count = 0: Remove all matching elements
   *
   * The value is JSON-serialized before matching.
   * Returns the number of removed elements.
   */
  async lrem<T>(key: string, count: number, value: T): Promise<number> {
    try {
      const serialised = JSON.stringify(value);
      return await this.redis.lrem(key, count, serialised);
    } catch (err) {
      this.logger.warn(
        `Redis lrem failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  }

  /**
   * Set an expiry (TTL) on an existing key.
   */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    try {
      await this.redis.expire(key, ttlSeconds);
    } catch (err) {
      this.logger.warn(
        `Redis expire failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ── Distributed Locking ─────────────────────────────────────────────────

  /**
   * Acquire a distributed lock using Redis SET NX EX.
   * Returns a unique token if the lock was acquired, or null if it's already held.
   * The lock automatically expires after ttlSeconds.
   */
  async acquireLock(key: string, ttlSeconds: number): Promise<string | null> {
    try {
      const token = `${Date.now()}-${Math.random().toString(36).substring(2)}`;
      const result = await this.redis.set(key, token, 'EX', ttlSeconds, 'NX');
      return result === 'OK' ? token : null;
    } catch (err) {
      this.logger.warn(
        `Redis acquireLock failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Release a distributed lock by verifying the token matches before deleting.
   * Uses a Lua script to ensure atomicity.
   * Returns true if the lock was released, false if token didn't match or key doesn't exist.
   */
  async releaseLock(key: string, token: string): Promise<boolean> {
    try {
      const script = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      const result = await this.redis.eval(script, 1, key, token);
      return result === 1;
    } catch (err) {
      this.logger.warn(
        `Redis releaseLock failed for key ${key}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }
}
