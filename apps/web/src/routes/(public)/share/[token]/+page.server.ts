import type { PageServerLoad } from './$types';
import { db, shares, maps, layers } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params }) => {
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
