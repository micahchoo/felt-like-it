/**
 * In-memory sliding-window rate limiter.
 *
 * Suitable for single-process deployments (adapter-node).
 * For multi-replica (Phase 7 Helm), replace with Redis INCR.
 */

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
}

/** Creates an independent rate-limiter instance with its own window map. */
export function createRateLimiter(opts: RateLimiterOptions) {
  const windows = new Map<string, number[]>();

  // Prune stale entries every 5 minutes to prevent unbounded memory growth
  const pruneTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, timestamps] of windows) {
      if (timestamps.length === 0 || now - timestamps[timestamps.length - 1]! > opts.windowMs) {
        windows.delete(key);
      }
    }
  }, 5 * 60_000);
  pruneTimer.unref(); // so it doesn't keep the process alive

  return {
    /** Returns true if the request is allowed, false if rate-limited. */
    check(key: string): boolean {
      const now = Date.now();
      const timestamps = windows.get(key) ?? [];
      const recent = timestamps.filter((t) => now - t < opts.windowMs);

      if (recent.length >= opts.maxRequests) {
        windows.set(key, recent);
        return false;
      }

      recent.push(now);
      windows.set(key, recent);
      return true;
    },

    /** Clear all tracked windows. Exported for tests. */
    reset(): void {
      windows.clear();
    },
  };
}

// ── Default auth limiter (backward-compatible) ──────────────────────
const authLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });

/** Returns true if the request is allowed, false if rate-limited. */
export function checkRateLimit(ip: string): boolean {
  return authLimiter.check(ip);
}

/** Clear all tracked windows. Exported for tests. */
export function resetRateLimits(): void {
  authLimiter.reset();
}
