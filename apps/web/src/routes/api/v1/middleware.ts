import { createHash } from 'crypto';
import { eq } from 'drizzle-orm';
import { db, apiKeys, shares, users } from '$lib/server/db/index.js';
import { toErrorResponse } from './errors.js';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Recursively strip null bytes from all string values in an object.
 * PostgreSQL text/jsonb columns reject \0 — sanitize at the API boundary.
 */
export function stripNullBytes<T>(value: T): T {
  if (typeof value === 'string') return value.replaceAll('\0', '') as T;
  if (Array.isArray(value)) return value.map(stripNullBytes) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = stripNullBytes(v);
    }
    return out as T;
  }
  return value;
}

export interface ApiAuth {
  userId: string | null;
  scope: 'read' | 'read-write';
  mapScope: string | null;
}

/**
 * Resolve auth from Bearer header or ?token query param.
 * Returns null if no credentials provided (caller should return 401).
 *
 * When hooks.server.ts has already resolved an API key, the result is
 * available in event.locals.apiAuth — this avoids a duplicate DB lookup.
 */
export async function resolveAuth(event: Pick<RequestEvent, 'request' | 'url' | 'locals'>): Promise<ApiAuth | null> {
  try {
    // 0. Return pre-resolved API key auth from hooks.server.ts if available
    if (event.locals.apiAuth) return event.locals.apiAuth;

    // 1. Check Bearer API key (fallback — should only hit for non-hook paths or tests)
    const authHeader = event.request.headers.get('authorization');
    if (authHeader?.startsWith('Bearer flk_')) {
      const rawKey = authHeader.slice(7);
      const hash = createHash('sha256').update(rawKey).digest('hex');

      const [keyRow] = await db
        .select({ id: apiKeys.id, userId: apiKeys.userId, scope: apiKeys.scope })
        .from(apiKeys)
        .where(eq(apiKeys.keyHash, hash));

      if (!keyRow) return null;

      // Verify user exists and is not disabled
      const [userRow] = await db
        .select({ id: users.id, disabledAt: users.disabledAt })
        .from(users)
        .where(eq(users.id, keyRow.userId));

      if (!userRow || userRow.disabledAt) return null;

      // Fire-and-forget: update last_used_at
      void db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, keyRow.id));

      return {
        userId: keyRow.userId,
        scope: keyRow.scope as 'read' | 'read-write',
        mapScope: null,
      };
    }

    // 2. Check ?token share token
    const token = event.url.searchParams.get('token');
    if (token) {
      const [shareRow] = await db
        .select({ mapId: shares.mapId })
        .from(shares)
        .where(eq(shares.token, token));

      if (!shareRow) return null;

      return {
        userId: null,
        scope: 'read',
        mapScope: shareRow.mapId,
      };
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Assert the auth context has at least the required scope.
 * Throws a plain Error (caught by route handlers to return 403).
 */
export function requireScope(auth: ApiAuth, required: 'read' | 'read-write'): void {
  if (required === 'read-write' && auth.scope !== 'read-write') {
    throw new Error('FORBIDDEN');
  }
}

/**
 * Assert the auth context can access the given map.
 * For share tokens, checks mapScope matches. For API keys, defers to requireMapAccess.
 */
export function assertMapAccess(auth: ApiAuth, mapId: string): void {
  if (auth.mapScope !== null && auth.mapScope !== mapId) {
    throw new Error('MAP_NOT_FOUND');
  }
}

/** Wrap response data in the standard envelope. */
export function envelope(
  data: unknown,
  meta: Record<string, unknown> = {},
  links: Record<string, string> = {},
) {
  return { data, meta, links };
}

/** Standard JSON response helper. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ── Rate Limiting (in-memory sliding window) ──────────────────────────────────

const WINDOW_MS = 1000;
const counters = new Map<string, { count: number; resetAt: number }>();

const API_KEY_LIMIT = parseInt(process.env.API_RATE_LIMIT ?? '100', 10);
const SHARE_TOKEN_LIMIT = 30;

/**
 * Rate limit by auth identity (userId for API keys, mapScope for share tokens).
 */
export function rateLimit(auth: ApiAuth): Response | null {
  const key = auth.userId ?? `share:${auth.mapScope}`;
  const limit = auth.userId ? API_KEY_LIMIT : SHARE_TOKEN_LIMIT;
  const now = Date.now();

  let entry = counters.get(key);
  if (!entry || now >= entry.resetAt) {
    entry = { count: 0, resetAt: now + WINDOW_MS };
    counters.set(key, entry);
  }

  entry.count++;
  if (entry.count > limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    const res = toErrorResponse('RATE_LIMITED', 'Too many requests');
    // Clone to add Retry-After header (toErrorResponse returns immutable headers)
    return new Response(res.body, {
      status: res.status,
      headers: { ...Object.fromEntries(res.headers.entries()), 'Retry-After': String(retryAfter || 1) },
    });
  }
  return null;
}
