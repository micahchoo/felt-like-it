// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkRateLimit, resetRateLimits } from '$lib/server/rate-limit.js';

describe('rate limiter', () => {
  beforeEach(() => {
    resetRateLimits();
    vi.useRealTimers();
  });

  it('allows requests under the limit', () => {
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit('127.0.0.1')).toBe(true);
    }
  });

  it('blocks the 11th request within the window', () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit('127.0.0.1');
    }
    expect(checkRateLimit('127.0.0.1')).toBe(false);
  });

  it('tracks IPs independently', () => {
    for (let i = 0; i < 10; i++) {
      checkRateLimit('127.0.0.1');
    }
    expect(checkRateLimit('127.0.0.1')).toBe(false);
    expect(checkRateLimit('192.168.1.1')).toBe(true);
  });

  it('allows requests after the window expires', () => {
    vi.useFakeTimers();
    for (let i = 0; i < 10; i++) {
      checkRateLimit('127.0.0.1');
    }
    expect(checkRateLimit('127.0.0.1')).toBe(false);

    vi.advanceTimersByTime(61_000);
    expect(checkRateLimit('127.0.0.1')).toBe(true);
    vi.useRealTimers();
  });
});
