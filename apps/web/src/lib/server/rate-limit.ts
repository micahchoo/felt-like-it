/**
 * In-memory sliding-window rate limiter.
 *
 * Suitable for single-process deployments (adapter-node).
 * For multi-replica (Phase 7 Helm), replace with Redis INCR.
 */

const AUTH_WINDOW_MS = 60_000;
const AUTH_MAX_REQUESTS = 10;

const windows = new Map<string, number[]>();

// Prune stale entries every 5 minutes to prevent unbounded memory growth
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of windows) {
    if (timestamps.length === 0 || now - timestamps[timestamps.length - 1]! > AUTH_WINDOW_MS) {
      windows.delete(ip);
    }
  }
}, 5 * 60_000).unref(); // unref() so it doesn't keep the process alive

/** Returns true if the request is allowed, false if rate-limited. */
export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const timestamps = windows.get(ip) ?? [];
  const recent = timestamps.filter((t) => now - t < AUTH_WINDOW_MS);

  if (recent.length >= AUTH_MAX_REQUESTS) {
    windows.set(ip, recent);
    return false;
  }

  recent.push(now);
  windows.set(ip, recent);
  return true;
}

/** Clear all tracked windows. Exported for tests. */
export function resetRateLimits(): void {
  windows.clear();
}
