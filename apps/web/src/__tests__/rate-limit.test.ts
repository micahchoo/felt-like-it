// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ioredis before importing the module under test
const store = new Map<string, { value: number; ttl: number }>();

vi.mock('ioredis', () => {
  class RedisMock {
    connected = true;
    async connect() {}
    async incr(key: string): Promise<number> {
      const entry = store.get(key) ?? { value: 0, ttl: -1 };
      entry.value += 1;
      store.set(key, entry);
      return entry.value;
    }
    async expire(key: string, seconds: number): Promise<number> {
      const entry = store.get(key);
      if (entry) entry.ttl = seconds;
      return 1;
    }
    async scan(cursor: string, ..._args: unknown[]): Promise<[string, string[]]> {
      // Return all keys on first call, '0' cursor to end
      if (cursor === '0') {
        return ['0', [...store.keys()]];
      }
      return ['0', []];
    }
    async del(...keys: string[]): Promise<number> {
      let count = 0;
      for (const k of keys) {
        if (store.delete(k)) count++;
      }
      return count;
    }
    async quit() {}
  }
  return { Redis: RedisMock };
});

// Import after mocking
const { checkRateLimit, resetRateLimits, disconnectRateLimitRedis } = await import(
  '$lib/server/rate-limit.js'
);

describe('rate limiter (Redis-backed)', () => {
  beforeEach(async () => {
    store.clear();
    await resetRateLimits();
  });

  afterEach(async () => {
    await disconnectRateLimitRedis();
  });

  it('allows requests under the limit', async () => {
    for (let i = 0; i < 10; i++) {
      expect(await checkRateLimit('127.0.0.1')).toBe(true);
    }
  });

  it('blocks the 11th request within the window', async () => {
    for (let i = 0; i < 10; i++) {
      await checkRateLimit('127.0.0.1');
    }
    expect(await checkRateLimit('127.0.0.1')).toBe(false);
  });

  it('tracks IPs independently', async () => {
    for (let i = 0; i < 10; i++) {
      await checkRateLimit('127.0.0.1');
    }
    expect(await checkRateLimit('127.0.0.1')).toBe(false);
    expect(await checkRateLimit('192.168.1.1')).toBe(true);
  });

  it('allows requests after reset', async () => {
    for (let i = 0; i < 10; i++) {
      await checkRateLimit('127.0.0.1');
    }
    expect(await checkRateLimit('127.0.0.1')).toBe(false);

    await resetRateLimits();
    expect(await checkRateLimit('127.0.0.1')).toBe(true);
  });
});
