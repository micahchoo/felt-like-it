/**
 * H5 — Idempotency-Key middleware for POST endpoints.
 *
 * Contract: when a client sends `Idempotency-Key: <k>` on a POST, the first
 * successful response is cached for 24h keyed by (userId, k). Replays with
 * the same key return the cached status/body/content-type verbatim — no
 * duplicate resource creation. Reusing the same key against a different
 * endpoint (method+path mismatch) is rejected 422 so bugs surface loudly
 * instead of returning a wrong-shaped cached payload.
 *
 * Key format: 16–200 chars, [A-Za-z0-9_-]. Malformed → 400 (reject fast,
 * never touch the DB). Format chosen to accept UUIDs, Stripe-style tokens,
 * and base64url nonces without normalization.
 *
 * Scoped to authenticated users only (auth.userId must be present). Share
 * tokens are read-only, so they never hit these handlers.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { and, eq } from 'drizzle-orm';
import { db } from './db/index.js';
import { idempotencyKeys } from './db/schema.js';
import { resolveAuth } from '../../routes/api/v1/middleware.js';
import { toErrorResponse } from '../../routes/api/v1/errors.js';

const KEY_REGEX = /^[A-Za-z0-9_-]{16,200}$/;
const TTL_MS = 24 * 60 * 60 * 1000; // 24h

type AnyEvent = Pick<RequestEvent, 'request' | 'url' | 'locals' | 'getClientAddress'>;

/**
 * Wrap a POST handler with Idempotency-Key support.
 *
 * If the header is absent: runs the handler directly.
 * If the header is present and malformed: 400.
 * If a cached (userId, key) row exists AND method+path match: return cache.
 * If a cached (userId, key) row exists but method+path differ: 422.
 * Otherwise: run handler; on 2xx, cache the response before returning.
 */
export async function withIdempotency(
  event: AnyEvent,
  handler: () => Promise<Response>,
): Promise<Response> {
  const rawKey = event.request.headers.get('Idempotency-Key');
  if (rawKey === null) return handler();

  if (!KEY_REGEX.test(rawKey)) {
    return toErrorResponse('VALIDATION_ERROR', 'Idempotency-Key must match [A-Za-z0-9_-]{16,200}');
  }

  // Resolve auth — we need userId to scope the cache. If auth is unknown
  // (no userId), fall through to handler so 401/403 surfaces normally from
  // the wrapped handler itself.
  const auth = await resolveAuth(event).catch(() => null);
  if (!auth?.userId) return handler();

  const userId = auth.userId;
  const method = event.request.method;
  const path = new URL(event.request.url).pathname;

  // Look up existing row.
  const [existing] = await db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, rawKey)))
    .limit(1);

  if (existing) {
    const age = Date.now() - new Date(existing.createdAt).getTime();
    if (age <= TTL_MS) {
      if (existing.method !== method || existing.path !== path) {
        return toErrorResponse(
          'VALIDATION_ERROR',
          'Idempotency-Key previously used on a different endpoint',
        );
      }
      return new Response(new Uint8Array(existing.responseBody), {
        status: existing.status,
        headers: {
          'Content-Type': existing.contentType,
          'Idempotency-Replayed': 'true',
        },
      });
    }
    // Stale row — best-effort delete; ignore races. A later insert will
    // conflict on the unique index, which we handle with onConflictDoNothing.
    await db
      .delete(idempotencyKeys)
      .where(and(eq(idempotencyKeys.userId, userId), eq(idempotencyKeys.key, rawKey)));
  }

  // Run the wrapped handler. We clone the Response before reading the body
  // so the original can still stream to the client.
  const response = await handler();

  // Only cache successful responses (2xx). Error responses shouldn't block
  // a client from retrying with the same key.
  if (response.status >= 200 && response.status < 300) {
    try {
      const buf = Buffer.from(await response.clone().arrayBuffer());
      const contentType = response.headers.get('Content-Type') ?? 'application/octet-stream';
      await db
        .insert(idempotencyKeys)
        .values({
          userId,
          key: rawKey,
          method,
          path,
          status: response.status,
          responseBody: buf,
          contentType,
        })
        .onConflictDoNothing({
          target: [idempotencyKeys.userId, idempotencyKeys.key],
        });
    } catch {
      // Caching failure must not fail the request — the client already got
      // their successful response, and a retry is at worst a duplicate.
    }
  }

  return response;
}
