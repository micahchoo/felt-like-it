import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { db, shares, maps, layers } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';

export const load: PageServerLoad = async ({ params, setHeaders }) => {
  const { token } = params;

  const [share] = await db.select().from(shares).where(eq(shares.token, token));

  if (!share) {
    error(404, 'Share link not found or expired.');
  }

  const [map] = await db.select().from(maps).where(eq(maps.id, share.mapId));

  if (!map) {
    error(404, 'Map not found.');
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
      viewport: map.viewport as { center: [number, number]; zoom: number; bearing: number; pitch: number },
      basemap: map.basemap,
    },
    layers: mapLayers.map((l) => ({ ...l, style: l.style as Record<string, unknown> })),
  };
};
