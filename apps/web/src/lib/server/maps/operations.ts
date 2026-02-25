import { TRPCError } from '@trpc/server';
import { eq, and, asc } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { db, maps, layers } from '../db/index.js';
import { appendAuditLog } from '../audit/index.js';

interface MapResult {
  id: string;
  title: string;
  [key: string]: unknown;
}

/**
 * Create a new map owned by the given user.
 * Logs `map.create` to the audit chain.
 */
export async function createMap(
  userId: string,
  title: string,
  description?: string | null,
): Promise<MapResult> {
  const [map] = await db
    .insert(maps)
    .values({
      userId,
      title,
      description: description ?? null,
    })
    .returning();

  if (!map) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create map.' });
  }

  void appendAuditLog({
    userId,
    action: 'map.create',
    entityType: 'map',
    entityId: map.id,
    mapId: map.id,
    metadata: { title: map.title },
  });

  return map;
}

export async function deleteMap(
  userId: string,
  mapId: string,
): Promise<{ deleted: true }> {
  const [existing] = await db
    .select()
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.userId, userId)));

  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
  }

  await db.delete(maps).where(eq(maps.id, mapId));

  void appendAuditLog({
    userId,
    action: 'map.delete',
    entityType: 'map',
    entityId: mapId,
    mapId,
    metadata: { title: existing.title },
  });

  return { deleted: true };
}

export async function cloneMap(
  userId: string,
  mapId: string,
): Promise<MapResult> {
  const [existing] = await db
    .select()
    .from(maps)
    .where(and(eq(maps.id, mapId), eq(maps.userId, userId)));

  if (!existing) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
  }

  const [newMap] = await db
    .insert(maps)
    .values({
      userId,
      title: `Copy of ${existing.title}`,
      description: existing.description ?? null,
      viewport: existing.viewport,
      basemap: existing.basemap,
    })
    .returning();

  if (!newMap) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to clone map.' });
  }

  void appendAuditLog({
    userId,
    action: 'map.clone',
    entityType: 'map',
    entityId: newMap.id,
    mapId: newMap.id,
    metadata: { sourceMapId: mapId, title: newMap.title },
  });

  const origLayers = await db
    .select()
    .from(layers)
    .where(eq(layers.mapId, mapId))
    .orderBy(asc(layers.zIndex));

  await Promise.all(
    origLayers.map(async (layer) => {
      const [newLayer] = await db
        .insert(layers)
        .values({
          mapId: newMap.id,
          name: layer.name,
          type: layer.type,
          style: layer.style,
          visible: layer.visible,
          zIndex: layer.zIndex,
          sourceFileName: layer.sourceFileName,
        })
        .returning();

      if (!newLayer) return;

      await db.execute(sql`
        INSERT INTO features (layer_id, geometry, properties)
        SELECT ${newLayer.id}, geometry, properties
        FROM features
        WHERE layer_id = ${layer.id}
      `);
    })
  );

  return newMap;
}

export async function createFromTemplate(
  userId: string,
  templateId: string,
): Promise<MapResult> {
  const [template] = await db
    .select()
    .from(maps)
    .where(and(eq(maps.id, templateId), eq(maps.isTemplate, true)));

  if (!template) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found.' });
  }

  const [newMap] = await db
    .insert(maps)
    .values({
      userId,
      title: template.title,
      description: template.description ?? null,
      viewport: template.viewport,
      basemap: template.basemap,
      isTemplate: false,
    })
    .returning();

  if (!newMap) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create map from template.' });
  }

  void appendAuditLog({
    userId,
    action: 'map.createFromTemplate',
    entityType: 'map',
    entityId: newMap.id,
    mapId: newMap.id,
    metadata: { templateId, title: newMap.title },
  });

  const templateLayers = await db
    .select()
    .from(layers)
    .where(eq(layers.mapId, templateId))
    .orderBy(asc(layers.zIndex));

  await Promise.all(
    templateLayers.map((layer) =>
      db.insert(layers).values({
        mapId: newMap.id,
        name: layer.name,
        type: layer.type,
        style: layer.style,
        visible: layer.visible,
        zIndex: layer.zIndex,
        sourceFileName: null,
      })
    )
  );

  return newMap;
}
