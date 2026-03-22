import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, sql } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, layers } from '../../db/index.js';
import { CreateLayerSchema, UpdateLayerSchema } from '@felt-like-it/shared-types';
import type { Layer, LayerStyle } from '@felt-like-it/shared-types';
import { requireMapAccess } from '../../geo/access.js';

export const layersRouter = router({
  list: protectedProcedure
    .input(z.object({ mapId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      // Viewer+ access required to list layers
      await requireMapAccess(ctx.user.id, input.mapId, 'viewer');

      // Include feature count per layer (used for Martin tile-source threshold)
      const result = await db.execute(sql`
        SELECT
          l.id, l.map_id AS "mapId", l.name, l.type, l.style, l.visible,
          l.z_index AS "zIndex", l.source_file_name AS "sourceFileName",
          l.version,
          l.created_at AS "createdAt", l.updated_at AS "updatedAt",
          COALESCE(
            (SELECT COUNT(*) FROM features f WHERE f.layer_id = l.id),
            0
          )::int AS "featureCount"
        FROM layers l
        WHERE l.map_id = ${input.mapId}
        ORDER BY l.z_index ASC
      `);

      return result.rows.map((l) => {
        const row = l as Record<string, unknown>;
        return {
          id:             row['id'] as string,
          mapId:          row['mapId'] as string,
          name:           row['name'] as string,
          type:           row['type'] as Layer['type'],
          style:          row['style'] as LayerStyle,
          visible:        row['visible'] as boolean,
          zIndex:         row['zIndex'] as number,
          sourceFileName: (row['sourceFileName'] as string | null) ?? null,
          createdAt:      row['createdAt'] as Date,
          updatedAt:      row['updatedAt'] as Date,
          version:        Number(row['version'] ?? 1),
          featureCount:   Number(row['featureCount'] ?? 0),
        };
      });
    }),

  create: protectedProcedure
    .input(CreateLayerSchema)
    .mutation(async ({ ctx, input }) => {
      // Editor+ access required to create layers
      await requireMapAccess(ctx.user.id, input.mapId, 'editor');

      // Get next z_index
      const existingLayers = await db
        .select({ zIndex: layers.zIndex })
        .from(layers)
        .where(eq(layers.mapId, input.mapId))
        .orderBy(layers.zIndex);

      const maxZ = existingLayers.reduce((max, l) => Math.max(max, l.zIndex), -1);

      const [layer] = await db
        .insert(layers)
        .values({
          mapId: input.mapId,
          name: input.name,
          type: input.type ?? 'mixed',
          zIndex: maxZ + 1,
        })
        .returning();

      if (!layer) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create layer.' });
      }

      return { ...layer, type: layer.type as Layer['type'] };
    }),

  update: protectedProcedure
    .input(z.object({ id: z.string().uuid() }).merge(UpdateLayerSchema))
    .mutation(async ({ ctx, input }) => {
      const { id, version, ...data } = input;

      const [layer] = await db
        .select({ id: layers.id, mapId: layers.mapId })
        .from(layers)
        .where(eq(layers.id, id));

      if (!layer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Layer not found.' });
      }

      await requireMapAccess(ctx.user.id, layer.mapId, 'editor');

      const whereClause = version !== undefined
        ? and(eq(layers.id, id), eq(layers.version, version))
        : eq(layers.id, id);

      const [updated] = await db
        .update(layers)
        .set({
          ...(data.name !== undefined && { name: data.name }),
          ...(data.style !== undefined && { style: data.style }),
          ...(data.visible !== undefined && { visible: data.visible }),
          ...(data.zIndex !== undefined && { zIndex: data.zIndex }),
          version: sql`version + 1`,
        })
        .where(whereClause)
        .returning();

      if (!updated) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'This layer was modified by another user. Please reload to see their changes.',
        });
      }
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [layer] = await db
        .select({ id: layers.id, mapId: layers.mapId })
        .from(layers)
        .where(eq(layers.id, input.id));

      if (!layer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Layer not found.' });
      }

      // Editor+ access required to delete layers
      await requireMapAccess(ctx.user.id, layer.mapId, 'editor');

      await db.delete(layers).where(eq(layers.id, input.id));
      return { deleted: true };
    }),

  reorder: protectedProcedure
    .input(
      z.object({
        mapId: z.string().uuid(),
        order: z.array(
          z.object({ id: z.string().uuid(), version: z.number().int().positive() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireMapAccess(ctx.user.id, input.mapId, 'editor');

      await db.transaction(async (tx) => {
        for (const [i, entry] of input.order.entries()) {
          const { id, version } = entry;
          const [updated] = await tx
            .update(layers)
            .set({ zIndex: i, version: sql`version + 1` })
            .where(
              and(
                eq(layers.id, id),
                eq(layers.mapId, input.mapId),
                eq(layers.version, version),
              ),
            )
            .returning();

          if (!updated) {
            throw new TRPCError({
              code: 'CONFLICT',
              message: 'Layer order has changed. Please reload to see the latest order.',
            });
          }
        }
      });

      return { success: true };
    }),
});
