import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { db, maps, layers } from '$lib/server/db/index.js';
import { eq, and } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.user) error(401, 'Unauthorized');
  const userId = locals.user.id;
  const mapId = params.id;

  const [map] = await db
    .select()
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.userId, userId)));

  if (!map) {
    error(404, 'Map not found');
  }

  const mapLayers = await db
    .select()
    .from(layers)
    .where(eq(layers.mapId, mapId))
    .orderBy(layers.zIndex);

  return {
    map: {
      ...map,
      viewport: map.viewport as { center: [number, number]; zoom: number; bearing: number; pitch: number },
    },
    layers: mapLayers.map((l) => ({ ...l, style: l.style as Record<string, unknown> })),
    userId: locals.user.id,
  };
};
