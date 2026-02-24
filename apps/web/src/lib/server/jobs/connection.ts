import { Redis } from 'ioredis';
import { env } from '$env/dynamic/private';

// Shared Redis connection for BullMQ
export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL ?? 'redis://localhost:6379', {
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
  });
}
