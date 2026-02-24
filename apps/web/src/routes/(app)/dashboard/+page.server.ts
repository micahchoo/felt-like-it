import type { PageServerLoad, Actions } from './$types';
import { db, maps } from '$lib/server/db/index.js';
import { eq, and, desc, asc } from 'drizzle-orm';
import { layers, mapCollaborators } from '$lib/server/db/schema.js';
import { sql } from 'drizzle-orm';
import { fail, redirect } from '@sveltejs/kit';

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
    .where(and(eq(maps.userId, userId), eq(maps.isArchived, false)))
    .orderBy(desc(maps.updatedAt));

  // Get layer counts
  const counts = await db
    .select({
      mapId: layers.mapId,
      count: sql<number>`count(*)`,
    })
    .from(layers)
    .groupBy(layers.mapId);

  const countMap = new Map(counts.map((c) => [c.mapId, c.count]));

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
    viewport: t.viewport as TemplateEntry['viewport'],
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
    .innerJoin(maps, and(eq(maps.id, mapCollaborators.mapId), eq(maps.isArchived, false)))
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
    const userId = locals.user.id;
    const formData = await request.formData();
    const title = (formData.get('title') as string | null)?.trim() ?? 'Untitled Map';

    const [map] = await db
      .insert(maps)
      .values({ userId, title })
      .returning({ id: maps.id });

    if (!map) return fail(500, { message: 'Failed to create map.' });

    redirect(302, `/map/${map.id}`);
  },

  deleteMap: async ({ locals, request }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const userId = locals.user.id;
    const formData = await request.formData();
    const mapId = formData.get('mapId') as string;

    await db
      .delete(maps)
      .where(and(eq(maps.id, mapId), eq(maps.userId, userId)));

    return { deleted: true };
  },

  cloneMap: async ({ locals, request }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const userId = locals.user.id;
    const formData = await request.formData();
    const mapId = formData.get('mapId') as string;

    const [existing] = await db
      .select()
      .from(maps)
      .where(and(eq(maps.id, mapId), eq(maps.userId, userId)));

    if (!existing) return fail(404, { message: 'Map not found.' });

    const [newMap] = await db
      .insert(maps)
      .values({
        userId,
        title: `Copy of ${existing.title}`,
        description: existing.description ?? null,
        viewport: existing.viewport as Record<string, unknown>,
        basemap: existing.basemap,
      })
      .returning({ id: maps.id });

    if (!newMap) return fail(500, { message: 'Failed to clone map.' });

    const origLayers = await db
      .select()
      .from(layers)
      .where(eq(layers.mapId, mapId))
      .orderBy(asc(layers.zIndex));

    for (const layer of origLayers) {
      const [newLayer] = await db
        .insert(layers)
        .values({
          mapId: newMap.id,
          name: layer.name,
          type: layer.type,
          style: layer.style as Record<string, unknown>,
          visible: layer.visible,
          zIndex: layer.zIndex,
          sourceFileName: layer.sourceFileName,
        })
        .returning({ id: layers.id });

      if (!newLayer) continue;

      await db.execute(sql`
        INSERT INTO features (layer_id, geometry, properties)
        SELECT ${newLayer.id}, geometry, properties
        FROM features
        WHERE layer_id = ${layer.id}
      `);
    }

    redirect(302, `/map/${newMap.id}`);
  },

  /**
   * Create a new user map from a template map.
   * Clones the template's viewport/basemap/layers to a fresh user-owned map,
   * then redirects to the new map editor. Features are NOT copied — templates
   * are config-only starters.
   */
  useTemplate: async ({ locals, request }) => {
    if (!locals.user) redirect(302, '/auth/login');
    const userId = locals.user.id;
    const formData = await request.formData();
    const templateId = formData.get('templateId') as string;

    const [template] = await db
      .select()
      .from(maps)
      .where(and(eq(maps.id, templateId), eq(maps.isTemplate, true)));

    if (!template) return fail(404, { message: 'Template not found.' });

    const [newMap] = await db
      .insert(maps)
      .values({
        userId,
        title: template.title,
        description: template.description ?? null,
        viewport: template.viewport as Record<string, unknown>,
        basemap: template.basemap,
        isTemplate: false,
      })
      .returning({ id: maps.id });

    if (!newMap) return fail(500, { message: 'Failed to create map from template.' });

    // Copy layer config (style, type, name) — no features (templates are config-only)
    const templateLayers = await db
      .select()
      .from(layers)
      .where(eq(layers.mapId, templateId))
      .orderBy(asc(layers.zIndex));

    for (const layer of templateLayers) {
      await db.insert(layers).values({
        mapId: newMap.id,
        name: layer.name,
        type: layer.type,
        style: layer.style as Record<string, unknown>,
        visible: layer.visible,
        zIndex: layer.zIndex,
        sourceFileName: null,
      });
    }

    redirect(302, `/map/${newMap.id}`);
  },
};
