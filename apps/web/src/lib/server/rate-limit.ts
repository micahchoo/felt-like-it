/**
 * Redis-backed sliding-window rate limiter.
 *
 * Uses INCR + EXPIRE on Redis keys so limits are shared across
 * multiple SvelteKit instances behind a load balancer.
 *
 * Key format: ratelimit:<scope>:<identifier>
 */

import { Redis } from 'ioredis';
import { env } from '$env/dynamic/private';

export interface RateLimiterOptions {
  /** Window duration in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed within the window. */
  maxRequests: number;
  /** Optional scope prefix for Redis keys (defaults to "default"). */
  scope?: string;
}

/** Lazy-initialized shared Redis connection for rate limiting. */
let redis: Redis | null = null;

function getRedis(): Redis {
  if (!redis) {
    redis = new Redis(env.REDIS_URL ?? 'redis://localhost:6379', {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redis.connect().catch(() => {
      // Connection errors are handled per-command; swallow initial connect error
    });
  }
  return redis;
}

/** Creates an independent rate-limiter instance backed by Redis. */
export function createRateLimiter(opts: RateLimiterOptions) {
  const scope = opts.scope ?? 'default';
  const windowSec = Math.ceil(opts.windowMs / 1000);

  return {
    /**
     * Returns true if the request is allowed, false if rate-limited.
     *
     * Uses Redis INCR + EXPIRE:
     * - INCR the key (atomic counter)
     * - If count is 1 (first request in window), set EXPIRE
     * - If count > max, reject
     *
     * On Redis failure, the request is allowed (fail-open).
     */
    async check(key: string): Promise<boolean> {
      try {
        const redisKey = `ratelimit:${scope}:${key}`;
        const r = getRedis();
        const count = await r.incr(redisKey);
        if (count === 1) {
          // First request in this window — set expiry
          await r.expire(redisKey, windowSec);
        }
        return count <= opts.maxRequests;
      } catch {
        // Fail open — if Redis is down, allow the request
        return true;
      }
    },

    /**
     * Clear all tracked windows matching this scope.
     * Exported for tests — uses SCAN to avoid blocking Redis.
     */
    async reset(): Promise<void> {
      try {
        const r = getRedis();
        const pattern = `ratelimit:${scope}:*`;
        let cursor = '0';
        do {
          const [nextCursor, keys] = await r.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
          cursor = nextCursor;
          if (keys.length > 0) {
            await r.del(...keys);
          }
        } while (cursor !== '0');
      } catch {
        // Ignore cleanup failures
      }
    },
  };
}

// ── Default auth limiter (backward-compatible) ──────────────────────
const authLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10, scope: 'auth' });

/** Returns true if the request is allowed, false if rate-limited. */
export async function checkRateLimit(ip: string): Promise<boolean> {
  return authLimiter.check(ip);
}

/** Clear all tracked windows. Exported for tests. */
export async function resetRateLimits(): Promise<void> {
  await authLimiter.reset();
}

/**
 * Disconnect the shared Redis client.
 * Call during graceful shutdown or test teardown.
 */
export async function disconnectRateLimitRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}
