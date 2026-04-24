import { createHash, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db, apiKeys, users } from '$lib/server/db/index.js';

export interface ResolvedApiKey {
  keyId: string;
  userId: string;
  scope: 'read' | 'read-write';
  userIsDisabled: boolean;
}

/**
 * Resolve an API key without leaking byte-level timing.
 *
 * The plaintext format is `flk_` + 64 hex chars (68 total). We fetch candidate
 * rows by the non-secret `prefix` (first 12 chars) — a public shard key that
 * narrows the search but cannot be used to probe for secrets. We then compare
 * the stored hash against the request hash with `crypto.timingSafeEqual`.
 *
 * Returns null for malformed keys, unknown prefixes, non-matching hashes, or
 * disabled users. Caller decides whether to emit 401.
 *
 * The previous implementation (`WHERE key_hash = ...`) pushed the secret into
 * the B-tree comparison, which short-circuits on mismatched bytes. This version
 * lifts the comparison into Node and uses a constant-time compare.
 */
export async function resolveApiKey(rawKey: string): Promise<ResolvedApiKey | null> {
  if (rawKey.length !== 68 || !rawKey.startsWith('flk_')) return null;

  const prefix = rawKey.slice(0, 12);
  const requestHashHex = createHash('sha256').update(rawKey).digest('hex');
  const requestHashBuf = Buffer.from(requestHashHex, 'hex');

  const rows = await db
    .select({
      id: apiKeys.id,
      userId: apiKeys.userId,
      scope: apiKeys.scope,
      keyHash: apiKeys.keyHash,
    })
    .from(apiKeys)
    .where(eq(apiKeys.prefix, prefix));

  let matched: (typeof rows)[number] | null = null;
  for (const row of rows) {
    const rowHashBuf = Buffer.from(row.keyHash, 'hex');
    if (rowHashBuf.length !== requestHashBuf.length) continue;
    if (timingSafeEqual(rowHashBuf, requestHashBuf)) {
      matched = row;
    }
  }
  if (!matched) return null;

  const [userRow] = await db
    .select({ disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, matched.userId));

  return {
    keyId: matched.id,
    userId: matched.userId,
    scope: matched.scope as 'read' | 'read-write',
    userIsDisabled: !!userRow?.disabledAt,
  };
}
