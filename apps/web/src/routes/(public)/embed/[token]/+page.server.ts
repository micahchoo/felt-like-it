import type { PageServerLoad } from './$types';
import { db, shares, maps, layers } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
  const { token } = params;

  const [share] = await db.select().from(shares).where(eq(shares.token, token));

  if (!share) {
    return { error: 'not_found' as const };
  }

  const [map] = await db.select().from(maps).where(eq(maps.id, share.mapId));

  if (!map) {
    return { error: 'not_found' as const };
  }

  const mapLayers = await db
    .select()
    .from(layers)
    .where(eq(layers.mapId, map.id))
    .orderBy(layers.zIndex);

  // 05b0: tighten frame-ancestors. The shares schema has no per-share embed
  // allowlist or opt-in field today (see apps/web/src/lib/server/db/schema.ts —
  // shares carries only id/mapId/token/accessLevel/expiresAt). Until that field
  // exists we MUST NOT silently default to `*`; that would let any origin frame
  // an authenticated-share's resolved content. Default-deny instead. Self-hosters
  // that need embedding today can override via their reverse proxy.
  // TODO(unified-embed-allowlist): replace 'none' with a space-separated list
  // built from a future shares.embedDomains column. Opt-in only — empty/null
  // stays 'none'.
  //
  // Cache-Control: same reasoning as the share route — per-request resolved
  // data, must not be cached by any intermediary.
  setHeaders({
    'Content-Security-Policy': "frame-ancestors 'none'",
    'Cache-Control': 'private, no-store',
  });

  return {
    map: {
      id: map.id,
      title: map.title,
      viewport: map.viewport,
      basemap: map.basemap,
    },
    layers: mapLayers.map((l) => ({
      ...l,
      createdAt: l.createdAt.toISOString(),
      updatedAt: l.updatedAt.toISOString(),
    })),
  };
};
