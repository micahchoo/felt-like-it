import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, desc } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { router, protectedProcedure } from '../init.js';
import { db, apiKeys } from '../../db/index.js';

/**
 * Generate a new API key.
 * Format: flk_<64-hex> (68 chars total).
 * Only the SHA-256 hash is stored; the plaintext is returned once.
 */
function generateApiKey(): { rawKey: string; hash: string; prefix: string } {
  const randomHex = randomBytes(32).toString('hex');
  const rawKey = `flk_${randomHex}`;
  const hash = createHash('sha256').update(rawKey).digest('hex');
  // 'flk_' (4) + 8 chars = 12-char display prefix, e.g. "flk_a1b2c3d4"
  const prefix = rawKey.slice(0, 12);
  return { rawKey, hash, prefix };
}

export const apiKeysRouter = router({
  /**
   * List all API keys for the authenticated user.
   * Key hashes are never returned.
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    return db
      .select({
        id: apiKeys.id,
        name: apiKeys.name,
        prefix: apiKeys.prefix,
        lastUsedAt: apiKeys.lastUsedAt,
        createdAt: apiKeys.createdAt,
      })
      .from(apiKeys)
      .where(eq(apiKeys.userId, ctx.user.id))
      .orderBy(desc(apiKeys.createdAt));
  }),

  /**
   * Create a new API key.
   * Returns the plaintext key once — it cannot be retrieved again.
   */
  create: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(64) }))
    .mutation(async ({ ctx, input }) => {
      const { rawKey, hash, prefix } = generateApiKey();

      const [record] = await db
        .insert(apiKeys)
        .values({
          userId: ctx.user.id,
          name: input.name,
          keyHash: hash,
          prefix,
        })
        .returning({
          id: apiKeys.id,
          name: apiKeys.name,
          prefix: apiKeys.prefix,
          createdAt: apiKeys.createdAt,
        });

      if (!record) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create API key.',
        });
      }

      return { key: rawKey, record };
    }),

  /**
   * Revoke (delete) an API key.
   * Caller must own the key.
   */
  revoke: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select({ id: apiKeys.id })
        .from(apiKeys)
        .where(and(eq(apiKeys.id, input.id), eq(apiKeys.userId, ctx.user.id)));

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'API key not found.' });
      }

      await db.delete(apiKeys).where(eq(apiKeys.id, input.id));

      return { revoked: true };
    }),
});
