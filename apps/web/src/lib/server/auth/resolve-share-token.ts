import { eq } from 'drizzle-orm';
import { db, shares, maps, layers } from '../db/index.js';

/**
 * F13.2 — single source of truth for "given a share token, fetch the map
 * + layers it grants access to."
 *
 * Replaces parallel implementations that previously lived in:
 *  - apps/web/src/routes/(public)/share/[token]/+page.server.ts
 *  - apps/web/src/lib/server/trpc/routers/shares.ts (resolve proc)
 *
 * The two callers wrap differently — server-load returns a typed
 * not_found marker for SvelteKit; tRPC throws TRPCError. Both share
 * the same DB lookup chain, which is what this helper owns.
 *
 * Format validation + rate limiting stay at the call sites because they
 * depend on caller context (IP for rate-limit; SvelteKit error model
 * for page-load). This helper assumes a non-empty token string and
 * runs only the DB chain.
 */
export interface ResolveShareSuccess {
  kind: 'ok';
  share: typeof shares.$inferSelect;
  map: typeof maps.$inferSelect;
  layers: (typeof layers.$inferSelect)[];
}

export interface ResolveShareNotFound {
  kind: 'not_found';
}

export async function resolveShareToken(
  token: string,
): Promise<ResolveShareSuccess | ResolveShareNotFound> {
  const [share] = await db.select().from(shares).where(eq(shares.token, token));
  if (!share) return { kind: 'not_found' };

  const [map] = await db.select().from(maps).where(eq(maps.id, share.mapId));
  if (!map) return { kind: 'not_found' };

  const mapLayers = await db
    .select()
    .from(layers)
    .where(eq(layers.mapId, map.id))
    .orderBy(layers.zIndex);

  return { kind: 'ok', share, map, layers: mapLayers };
}
