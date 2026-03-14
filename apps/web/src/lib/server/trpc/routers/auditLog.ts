import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, desc, asc } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, auditLog } from '../../db/index.js';
import { requireMapOwnership } from '../../geo/access.js';
import { computeChainHash, GENESIS_HASH } from '../../audit/index.js';

export const auditLogRouter = router({
  /**
   * List audit log entries for a map.
   * Caller must own the map. Ordered newest-first. Paginated.
   */
  list: protectedProcedure
    .input(
      z.object({
        mapId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(100),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireMapOwnership(ctx.user.id, input.mapId);

      return db
        .select()
        .from(auditLog)
        .where(eq(auditLog.mapId, input.mapId))
        .orderBy(desc(auditLog.seq))
        .limit(input.limit)
        .offset(input.offset);
    }),

  /**
   * Verify the integrity of the global audit log hash chain.
   *
   * Recomputes each row's chain_hash and confirms it matches the stored value
   * and that prev_hash references the preceding row's chain_hash correctly.
   *
   * NOTE: reads all rows in order — expensive on very large logs. Intended for
   * scheduled integrity checks, not real-time use.
   */
  verify: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.user.isAdmin) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin access required.' });
    }
    const entries = await db
      .select()
      .from(auditLog)
      .orderBy(asc(auditLog.seq));

    if (entries.length === 0) {
      return { valid: true, entryCount: 0, firstInvalidSeq: null };
    }

    let prevHash = GENESIS_HASH;

    for (const entry of entries) {
      const expected = computeChainHash(
        {
          userId: entry.userId,
          action: entry.action as Parameters<typeof computeChainHash>[0]['action'],
          entityType: entry.entityType,
          ...(entry.entityId != null ? { entityId: entry.entityId } : {}),
          ...(entry.mapId != null ? { mapId: entry.mapId } : {}),
          metadata: entry.metadata,
        },
        prevHash,
        entry.createdAt
      );

      if (entry.prevHash !== prevHash || entry.chainHash !== expected) {
        return { valid: false, entryCount: entries.length, firstInvalidSeq: entry.seq };
      }

      prevHash = entry.chainHash;
    }

    return { valid: true, entryCount: entries.length, firstInvalidSeq: null };
  }),
});
