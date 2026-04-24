import type { PageServerLoad } from './$types';
import { db, shares, maps, layers } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import { isValidShareTokenFormat, shareTokenLimiter } from '$lib/server/auth/share-token.js';

export const load: PageServerLoad = async ({ params, getClientAddress }) => {
  const { token } = params;

  // H2/L1: reject malformed tokens without touching the DB, and rate-limit
  // brute-force attempts per IP.
  if (!isValidShareTokenFormat(token)) {
    return { error: 'not_found' as const };
  }
  const allowed = await shareTokenLimiter.check(getClientAddress());
  if (!allowed) {
    return { error: 'not_found' as const };
  }

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

  return {
    map: {
      id: map.id,
      title: map.title,
      viewport: map.viewport,
      basemap: map.basemap,
    },
    layers: mapLayers,
    share: { token: share.token, accessLevel: share.accessLevel },
  };
};
