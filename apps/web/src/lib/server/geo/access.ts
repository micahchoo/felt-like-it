import { TRPCError } from '@trpc/server';
import { eq, and } from 'drizzle-orm';
import { db, maps, mapCollaborators } from '../db/index.js';

const ROLE_LEVEL = { viewer: 0, commenter: 1, editor: 2 } as const;
type CollabRole = keyof typeof ROLE_LEVEL;

/**
 * Assert that `userId` has at least `minRole` access on the map.
 *
 * Access model:
 *  - Map owner: always granted, regardless of `minRole`.
 *  - `minRole === 'owner'`: non-owners receive NOT_FOUND (map existence is hidden).
 *  - Collaborator with sufficient role: granted.
 *  - Collaborator with insufficient role: FORBIDDEN.
 *  - No collaborator record: NOT_FOUND (map existence is hidden from non-collaborators).
 *
 * @throws TRPCError on failure; resolves void on success.
 */
export async function requireMapAccess(
  userId: string,
  mapId: string,
  minRole: CollabRole | 'owner',
): Promise<void> {
  const [map] = await db
    .select({ id: maps.id, userId: maps.userId })
    .from(maps)
    .where(eq(maps.id, mapId));

  if (!map) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
  }

  // Owner fast-path — always granted
  if (map.userId === userId) return;

  // Non-owner requesting owner-level access — hide existence
  if (minRole === 'owner') {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
  }

  // Check collaborator record
  const [collab] = await db
    .select({ role: mapCollaborators.role })
    .from(mapCollaborators)
    .where(and(eq(mapCollaborators.mapId, mapId), eq(mapCollaborators.userId, userId)));

  if (!collab) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
  }

  // TYPE_DEBT: Drizzle infers `role` as `string`, not the enum union. Cast is safe
  // because unknown roles fall back to -1 via nullish coalescing.
  const userLevel = ROLE_LEVEL[collab.role as CollabRole] ?? -1;
  const minLevel  = ROLE_LEVEL[minRole];

  if (userLevel < minLevel) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: `This action requires ${minRole} access or higher.`,
    });
  }
}
