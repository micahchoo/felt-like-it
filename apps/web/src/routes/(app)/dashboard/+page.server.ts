import type { PageServerLoad, Actions } from './$types';
import { db, maps } from '$lib/server/db/index.js';
import { eq, desc, asc } from 'drizzle-orm';
import { layers, mapCollaborators } from '$lib/server/db/schema.js';
import { sql } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';
import { createMap, deleteMap, cloneMap, createFromTemplate } from '$lib/server/maps/operations.js';

/** Shape returned for each template in PageData.templates */
interface TemplateEntry {
  id: string;
  title: string;
  description: string | null;
  viewport: { center: [number, number]; zoom: number; bearing: number; pitch: number };
  basemap: string;
}

export const load: PageServerLoad = async ({ locals }) => {
  if (!locals.user) redirect(302, '/auth/login');
  const userId = locals.user.id;

  const userMaps = await db
    .select({
      id: maps.id,
      title: maps.title,
      description: maps.description,
      basemap: maps.basemap,
      createdAt: maps.createdAt,
      updatedAt: maps.updatedAt,
    })
    .from(maps)
    .where(eq(maps.userId, userId))
    .orderBy(desc(maps.updatedAt));

  // Get layer counts scoped to user's maps
  const mapIds = userMaps.map((m) => m.id);
  const countMap = new Map<string, number>();
  if (mapIds.length > 0) {
    const counts = await db
      .select({
        mapId: layers.mapId,
        count: sql<number>`count(*)`,
      })
      .from(layers)
      .where(sql`${layers.mapId} IN (${sql.join(mapIds.map((id) => sql`${id}`), sql`, `)})`)
      .groupBy(layers.mapId);
    for (const c of counts) countMap.set(c.mapId, c.count);
  }

  // Load template maps (shared across all users, ordered by title)
  const templateRows = await db
    .select({
      id: maps.id,
      title: maps.title,
      description: maps.description,
      viewport: maps.viewport,
      basemap: maps.basemap,
    })
    .from(maps)
    .where(eq(maps.isTemplate, true))
    .orderBy(asc(maps.title));

  const templates: TemplateEntry[] = templateRows.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description,
    viewport: t.viewport,
    basemap: t.basemap,
  }));

  // Maps the user has been invited to collaborate on (not their own maps)
  const sharedMaps = await db
    .select({
      id: maps.id,
      title: maps.title,
      description: maps.description,
      basemap: maps.basemap,
      createdAt: maps.createdAt,
      updatedAt: maps.updatedAt,
      role: mapCollaborators.role,
    })
    .from(mapCollaborators)
    .innerJoin(maps, eq(maps.id, mapCollaborators.mapId))
    .where(eq(mapCollaborators.userId, userId))
    .orderBy(desc(maps.updatedAt));

  return {
    maps: userMaps.map((m) => ({
      ...m,
      layerCount: Number(countMap.get(m.id) ?? 0),
    })),
    templates,
    sharedMaps,
  };
};

export const actions: Actions = {
  createMap: async ({ locals, request }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const formData = await request.formData();
    const title = (formData.get('title') as string | null)?.trim() ?? 'Untitled Map';
    const map = await createMap(locals.user.id, title).catch(() => null);
    if (!map) return fail(500, { message: 'Failed to create map.' });
    redirect(302, `/map/${map.id}`);
  },

  deleteMap: async ({ locals, request }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const formData = await request.formData();
    const mapId = formData.get('mapId') as string;
    const result = await deleteMap(locals.user.id, mapId).catch(() => null);
    if (!result) return fail(500, { error: 'Failed to delete map.' });
    return { deleted: true };
  },

  cloneMap: async ({ locals, request }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const formData = await request.formData();
    const mapId = formData.get('mapId') as string;
    const newMap = await cloneMap(locals.user.id, mapId).catch(() => null);
    if (!newMap) return fail(500, { message: 'Failed to clone map.' });
    redirect(302, `/map/${newMap.id}`);
  },

  useTemplate: async ({ locals, request }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const formData = await request.formData();
    const templateId = formData.get('templateId') as string;
    const newMap = await createFromTemplate(locals.user.id, templateId).catch(() => null);
    if (!newMap) return fail(500, { message: 'Failed to create map from template.' });
    redirect(302, `/map/${newMap.id}`);
  },
};
