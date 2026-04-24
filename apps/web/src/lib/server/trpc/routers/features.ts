import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, sql } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, layers } from '../../db/index.js';
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

});
