import { desc, eq, sql, asc } from 'drizzle-orm';
import { db, maps, auditLog, users } from '$lib/server/db/index.js';
import { computeChainHash, GENESIS_HASH } from '$lib/server/audit/index.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ url }) => {
  const selectedMapId = url.searchParams.get('mapId');

  // All maps for the selector (admin can see all)
  const allMaps = await db
    .select({ id: maps.id, title: maps.title, userId: maps.userId })
    .from(maps)
    .orderBy(desc(maps.updatedAt))
    .limit(200);

  // Global audit entry count
  const countRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(auditLog);
  const count = countRows[0]?.count ?? 0;

  // If a map is selected, fetch its entries (bypass ownership check for admin)
  let entries: Array<{
    seq: number;
    userId: string | null;
    action: string;
    entityType: string;
    entityId: string | null;
    mapId: string | null;
    metadata: Record<string, unknown> | null;
    prevHash: string;
    chainHash: string;
    createdAt: Date;
    userName: string | null;
  }> = [];

  if (selectedMapId) {
    const rows = await db
      .select({
        seq: auditLog.seq,
        userId: auditLog.userId,
        action: auditLog.action,
        entityType: auditLog.entityType,
        entityId: auditLog.entityId,
        mapId: auditLog.mapId,
        metadata: auditLog.metadata,
        prevHash: auditLog.prevHash,
        chainHash: auditLog.chainHash,
        createdAt: auditLog.createdAt,
        userName: users.name,
      })
      .from(auditLog)
      .leftJoin(users, eq(auditLog.userId, users.id))
      .where(eq(auditLog.mapId, selectedMapId))
      .orderBy(desc(auditLog.seq))
      .limit(200);

    entries = rows;
  }

  return { maps: allMaps, totalEntries: count, entries, selectedMapId };
};

/** Verify the global chain. Exported as a named action so the page can call it. */
export const actions = {
  verify: async () => {
    const allEntries = await db
      .select()
      .from(auditLog)
      .orderBy(asc(auditLog.seq));

    if (allEntries.length === 0) {
      return { valid: true, entryCount: 0, firstInvalidSeq: null };
    }

    let prevHash = GENESIS_HASH;

    for (const entry of allEntries) {
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
        return { valid: false, entryCount: allEntries.length, firstInvalidSeq: entry.seq };
      }

      prevHash = entry.chainHash;
    }

    return { valid: true, entryCount: allEntries.length, firstInvalidSeq: null };
  },
};
