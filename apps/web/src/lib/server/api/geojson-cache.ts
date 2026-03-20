import { createHash } from 'crypto';

interface CacheEntry {
  body: string;
  etag: string;
  expiresAt: number;
}

const TTL_MS = 30_000; // 30 seconds
const MAX_ENTRIES = 200;
const cache = new Map<string, CacheEntry>();

/** Build a cache key from layerId + optional bbox + limit. */
export function cacheKey(layerId: string, bbox: string | null, limit: number): string {
  return `${layerId}:${bbox ?? 'all'}:${limit}`;
}

/** Get a cached response if it exists and hasn't expired. */
export function getCachedGeoJSON(key: string): { body: string; etag: string } | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return { body: entry.body, etag: entry.etag };
}

/** Cache a GeoJSON response body. Returns the generated ETag. */
export function setCachedGeoJSON(key: string, body: string): string {
  // Evict first-inserted if at capacity (FIFO, not LRU)
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }

  const etag = createHash('md5').update(body).digest('hex').slice(0, 16);
  cache.set(key, { body, etag, expiresAt: Date.now() + TTL_MS });
  return etag;
}

/** Invalidate all cached entries for a given layerId. */
export function invalidateLayer(layerId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`${layerId}:`)) {
      cache.delete(key);
    }
  }
}
