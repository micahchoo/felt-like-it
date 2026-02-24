import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, asc, count, sql } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, maps, layers } from '../../db/index.js';
import { CreateMapSchema, UpdateMapSchema } from '@felt-like-it/shared-types';

export const mapsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;

    const rows = await db
      .select({
        id: maps.id,
        title: maps.title,
        description: maps.description,
        viewport: maps.viewport,
        basemap: maps.basemap,
        isArchived: maps.isArchived,
        createdAt: maps.createdAt,
        updatedAt: maps.updatedAt,
      })
      .from(maps)
      .where(and(eq(maps.userId, userId), eq(maps.isArchived, false)))
      .orderBy(desc(maps.updatedAt));

    // Get layer counts per map
    const layerCounts = await db
      .select({ mapId: layers.mapId, count: count() })
      .from(layers)
      .groupBy(layers.mapId);

    const countMap = new Map(layerCounts.map((r) => [r.mapId, r.count]));

    return rows.map((row) => ({
      ...row,
      viewport: row.viewport as { center: [number, number]; zoom: number; bearing: number; pitch: number },
      layerCount: countMap.get(row.id) ?? 0,
    }));
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [map] = await db
        .select()
        .from(maps)
        .where(and(eq(maps.id, input.id), eq(maps.userId, ctx.user.id)));

      if (!map) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
      }

      const mapLayers = await db
        .select()
        .from(layers)
        .where(eq(layers.mapId, input.id))
        .orderBy(layers.zIndex);

      return {
        ...map,
        viewport: map.viewport as { center: [number, number]; zoom: number; bearing: number; pitch: number },
        layers: mapLayers.map((l) => ({
          ...l,
          style: l.style as Record<string, unknown>,
        })),
      };
    }),

  create: protectedProcedure
    .input(CreateMapSchema)
    .mutation(async ({ ctx, input }) => {
      const [map] = await db
        .insert(maps)
        .values({
          userId: ctx.user.id,
          title: input.title,
          description: input.description ?? null,
        })
        .returning();

      if (!map) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create map.' });
      }

      return map;
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid() }).merge(UpdateMapSchema))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;

      const [existing] = await db
        .select()
        .from(maps)
        .where(and(eq(maps.id, id), eq(maps.userId, ctx.user.id)));

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
      }

      const [updated] = await db
        .update(maps)
        .set({
          ...(data.title !== undefined && { title: data.title }),
          ...(data.description !== undefined && { description: data.description }),
          ...(data.viewport !== undefined && { viewport: data.viewport }),
          ...(data.basemap !== undefined && { basemap: data.basemap }),
        })
        .where(eq(maps.id, id))
        .returning();

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select()
        .from(maps)
        .where(and(eq(maps.id, input.id), eq(maps.userId, ctx.user.id)));

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
      }

      await db.delete(maps).where(eq(maps.id, input.id));
      return { deleted: true };
    }),

  /**
   * List all maps marked as templates (isTemplate = true).
   * Returns regardless of ownership — templates are shared across all users.
   */
  listTemplates: protectedProcedure.query(async () => {
    const rows = await db
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

    return rows.map((row) => ({
      ...row,
      viewport: row.viewport as { center: [number, number]; zoom: number; bearing: number; pitch: number },
    }));
  }),

  /**
   * Create a new user map from a template (isTemplate = true map).
   * Clones the template's layers and config into a fresh map owned by the caller.
   * Template features are NOT copied — templates are style/config starters, not data starters.
   */
  createFromTemplate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [template] = await db
        .select()
        .from(maps)
        .where(and(eq(maps.id, input.id), eq(maps.isTemplate, true)));

      if (!template) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Template not found.' });
      }

      const [newMap] = await db
        .insert(maps)
        .values({
          userId: ctx.user.id,
          title: template.title,
          description: template.description ?? null,
          viewport: template.viewport as Record<string, unknown>,
          basemap: template.basemap,
          isTemplate: false,
        })
        .returning();

      if (!newMap) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create map from template.' });
      }

      // Copy layer config (style, type, name) — do NOT copy features (templates are config-only starters)
      const templateLayers = await db
        .select()
        .from(layers)
        .where(eq(layers.mapId, input.id))
        .orderBy(layers.zIndex);

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

      return newMap;
    }),

  /** Deep-clone a map: copies the map record, all layers, and all features. */
  clone: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [existing] = await db
        .select()
        .from(maps)
        .where(and(eq(maps.id, input.id), eq(maps.userId, ctx.user.id)));

      if (!existing) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
      }

      const [newMap] = await db
        .insert(maps)
        .values({
          userId: ctx.user.id,
          title: `Copy of ${existing.title}`,
          description: existing.description ?? null,
          viewport: existing.viewport as Record<string, unknown>,
          basemap: existing.basemap,
        })
        .returning();

      if (!newMap) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to clone map.' });
      }

      const origLayers = await db
        .select()
        .from(layers)
        .where(eq(layers.mapId, input.id))
        .orderBy(layers.zIndex);

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
          .returning();

        if (!newLayer) continue;

        // Copy features in one shot — preserves PostGIS geometry binary without WKB round-trip
        await db.execute(sql`
          INSERT INTO features (layer_id, geometry, properties)
          SELECT ${newLayer.id}, geometry, properties
          FROM features
          WHERE layer_id = ${layer.id}
        `);
      }

      return newMap;
    }),
});
