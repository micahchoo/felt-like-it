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

  // Allow this page to be embedded in any iframe.
  // adapter-node does not set X-Frame-Options by default, but we set CSP
  // frame-ancestors explicitly so the intent is unambiguous. A self-hoster
  // that wants to restrict embedding can override this via their reverse proxy.
  setHeaders({
    'Content-Security-Policy': "frame-ancestors *",
  });

  return {
    map: {
      id: map.id,
      title: map.title,
      viewport: map.viewport,
      basemap: map.basemap,
    },
    layers: mapLayers,
  };
};
