import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, layers, features } from '../../db/index.js';
import { requireMapAccess } from '../../geo/access.js';
import { annotationService } from '../../annotations/service.js';

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

      const upsertedIds = await Promise.all(
        input.features.map(async (feature) => {
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
            return feature.id;
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
            return (result.rows[0]?.['id'] as string | undefined) ?? null;
          }
        })
      );

      return { upsertedIds: upsertedIds.filter((id): id is string => id !== null) };
    }),

  /** Paginated feature listing with optional bbox filter — metadata only, no full geometry */
  listPaged: protectedProcedure
    .input(
      z.object({
        layerId: z.string().uuid(),
        limit: z.number().int().min(1).max(200).default(50),
        offset: z.number().int().min(0).default(0),
        bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
        sortBy: z.enum(['created_at', 'updated_at', 'id']).default('created_at'),
        sortDir: z.enum(['asc', 'desc']).default('asc'),
      })
    )
    .query(async ({ ctx, input }) => {
      const [layer] = await db
        .select({ id: layers.id, mapId: layers.mapId })
        .from(layers)
        .where(eq(layers.id, input.layerId));

      if (!layer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Layer not found.' });
      }

      await requireMapAccess(ctx.user.id, layer.mapId, 'viewer');

      // Build WHERE clause
      const conditions = [sql`layer_id = ${input.layerId}`];
      if (input.bbox) {
        const [west, south, east, north] = input.bbox;
        conditions.push(
          sql`ST_Intersects(geometry, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326))`
        );
      }
      const whereClause = sql.join(conditions, sql` AND `);

      // Sort — sql.raw() safe because sortBy validated by z.enum
      const orderExpr =
        input.sortDir === 'desc'
          ? sql`${sql.raw(input.sortBy)} DESC`
          : sql`${sql.raw(input.sortBy)} ASC`;

      // Count query
      const [countResult] = (
        await db.execute(sql`SELECT COUNT(*)::int AS total FROM features WHERE ${whereClause}`)
      ).rows;
      const total = (countResult?.['total'] as number) ?? 0;

      // Data query — metadata only, no full geometry serialisation
      const rows = await db.execute(sql`
        SELECT id, properties, ST_GeometryType(geometry) AS geometry_type,
               created_at, updated_at
        FROM features
        WHERE ${whereClause}
        ORDER BY ${orderExpr}
        LIMIT ${input.limit} OFFSET ${input.offset}
      `);

      return {
        total,
        rows: rows.rows.map((r) => ({
          id: r['id'] as string,
          properties: r['properties'] as Record<string, unknown>,
          geometryType: r['geometry_type'] as string,
          createdAt: r['created_at'] as string,
          updatedAt: r['updated_at'] as string,
        })),
      };
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

      // Flag any annotations anchored to the deleted features
      await annotationService.flagOrphanedAnnotations(input.ids);

      return { deleted: input.ids.length };
    }),
});
