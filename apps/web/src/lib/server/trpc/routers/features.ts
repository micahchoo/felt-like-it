import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, layers, features } from '../../db/index.js';
import { requireMapAccess } from '../../geo/access.js';

export const featuresRouter = router({
  /** Fetch all features for a layer as a GeoJSON FeatureCollection */
  list: protectedProcedure
    .input(z.object({ layerId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const [layer] = await db
        .select({ id: layers.id, mapId: layers.mapId })
        .from(layers)
        .where(eq(layers.id, input.layerId));

      if (!layer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Layer not found.' });
      }

      // Viewer+ access required to list features
      await requireMapAccess(ctx.user.id, layer.mapId, 'viewer');

      const rows = await db.execute(sql`
        SELECT
          id,
          layer_id,
          ST_AsGeoJSON(geometry)::json AS geometry,
          properties,
          created_at,
          updated_at
        FROM features
        WHERE layer_id = ${input.layerId}
        ORDER BY created_at ASC
      `);

      return {
        type: 'FeatureCollection' as const,
        features: rows.rows.map((row) => ({
          type: 'Feature' as const,
          id: row['id'] as string,
          geometry: row['geometry'] as Record<string, unknown>,
          properties: { ...(row['properties'] as Record<string, unknown>), _id: row['id'] },
        })),
      };
    }),

  /** Batch upsert features (insert new, update existing by ID) */
  upsert: protectedProcedure
    .input(
      z.object({
        layerId: z.string().uuid(),
        features: z.array(
          z.object({
            id: z.string().uuid().optional(),
            geometry: z.record(z.string(), z.unknown()),
            properties: z.record(z.string(), z.unknown()).nullable().optional(),
          })
        ),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [layer] = await db
        .select({ id: layers.id, mapId: layers.mapId })
        .from(layers)
        .where(eq(layers.id, input.layerId));

      if (!layer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Layer not found.' });
      }

      // Editor+ access required to upsert features
      await requireMapAccess(ctx.user.id, layer.mapId, 'editor');

      const upsertedIds: string[] = [];

      for (const feature of input.features) {
        const geomJson = JSON.stringify(feature.geometry);
        const props = feature.properties ?? {};

        if (feature.id) {
          // Update existing
          await db.execute(sql`
            UPDATE features
            SET
              geometry = ST_GeomFromGeoJSON(${geomJson}),
              properties = ${JSON.stringify(props)}::jsonb,
              updated_at = NOW()
            WHERE id = ${feature.id}
              AND layer_id = ${input.layerId}
          `);
          upsertedIds.push(feature.id);
        } else {
          // Insert new
          const result = await db.execute(sql`
            INSERT INTO features (layer_id, geometry, properties)
            VALUES (
              ${input.layerId},
              ST_GeomFromGeoJSON(${geomJson}),
              ${JSON.stringify(props)}::jsonb
            )
            RETURNING id
          `);
          const id = result.rows[0]?.['id'] as string | undefined;
          if (id) upsertedIds.push(id);
        }
      }

      return { upsertedIds };
    }),

  /** Delete features by ID */
  delete: protectedProcedure
    .input(
      z.object({
        layerId: z.string().uuid(),
        ids: z.array(z.string().uuid()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [layer] = await db
        .select({ id: layers.id, mapId: layers.mapId })
        .from(layers)
        .where(eq(layers.id, input.layerId));

      if (!layer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Layer not found.' });
      }

      // Editor+ access required to delete features
      await requireMapAccess(ctx.user.id, layer.mapId, 'editor');

      await db
        .delete(features)
        .where(
          and(eq(features.layerId, input.layerId), inArray(features.id, input.ids))
        );

      return { deleted: input.ids.length };
    }),
});
