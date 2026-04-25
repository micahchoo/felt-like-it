import type { PageServerLoad } from './$types';
import { error } from '@sveltejs/kit';
import { db, maps, layers, mapCollaborators } from '$lib/server/db/index.js';
import { eq, and } from 'drizzle-orm';

export const load: PageServerLoad = async ({ locals, params }) => {
  if (!locals.user) error(401, 'Unauthorized');
  const userId = locals.user.id;
  const mapId = params.id;

  // 1 — Fetch map (no ownership filter)
  const [map] = await db.select().from(maps).where(eq(maps.id, mapId));
  if (!map) error(404, 'Map not found');

  // 2 — Owner fast-path; collaborator fallback
  let userRole: 'owner' | 'editor' | 'commenter' | 'viewer' = 'owner';
  if (map.userId !== userId) {
    const [collab] = await db
      .select({ id: mapCollaborators.id, role: mapCollaborators.role })
      .from(mapCollaborators)
      .where(and(eq(mapCollaborators.mapId, mapId), eq(mapCollaborators.userId, userId)));
    if (!collab) error(404, 'Map not found');
    userRole = collab.role as 'editor' | 'commenter' | 'viewer';
  }

  const mapLayers = await db
    .select()
    .from(layers)
    .where(eq(layers.mapId, mapId))
    .orderBy(layers.zIndex);

  return {
    map: {
      ...map,
      createdAt: map.createdAt.toISOString(),
      updatedAt: map.updatedAt.toISOString(),
    },
    layers: mapLayers,
    userId: locals.user.id,
    userRole,
  };
};
