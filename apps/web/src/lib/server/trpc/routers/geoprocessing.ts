import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, maps, layers } from '../../db/index.js';
import { GeoprocessingOpSchema } from '@felt-like-it/shared-types';
import { runGeoprocessing, getOpLayerIds } from '../../geo/geoprocessing.js';

export const geoprocessingRouter = router({
  /**
   * Execute a geoprocessing operation and materialise the result as a new layer.
   * Returns the new layer's id and name so the client can load it immediately.
   *
   * Auth: caller must own the map. All input layers must belong to that map.
   */
  run: protectedProcedure
    .input(
      z.object({
        mapId: z.string().uuid(),
        op: GeoprocessingOpSchema,
        outputLayerName: z.string().min(1).max(255).trim(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      // 1 — Verify map ownership
      const [map] = await db
        .select({ id: maps.id })
        .from(maps)
        .where(and(eq(maps.id, input.mapId), eq(maps.userId, ctx.user.id)));

      if (!map) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
      }

      // 2 — Verify all input layers belong to this map.
      // One query per layer so eq()-only predicates work cleanly against mock columns in tests.
      const inputLayerIds = getOpLayerIds(input.op);

      for (const layerId of inputLayerIds) {
        const [ownedLayer] = await db
          .select({ id: layers.id })
          .from(layers)
          .where(and(eq(layers.id, layerId), eq(layers.mapId, input.mapId)));

        if (!ownedLayer) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'One or more input layers not found on this map.' });
        }
      }

      // 3 — Cross-field validation that Zod discriminated union can't enforce inline:
      //     aggregate sum/avg require a non-empty `field`.
      if (
        input.op.type === 'aggregate' &&
        input.op.aggregation !== 'count' &&
        !input.op.field
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'field is required for sum and avg aggregations.',
        });
      }

      // 4 — Determine z_index for output layer (next after current max)
      const existingLayers = await db
        .select({ zIndex: layers.zIndex })
        .from(layers)
        .where(eq(layers.mapId, input.mapId));

      const maxZ = existingLayers.reduce((max, l) => Math.max(max, l.zIndex), -1);

      // 5 — Create the output layer
      const [newLayer] = await db
        .insert(layers)
        .values({
          mapId: input.mapId,
          name: input.outputLayerName,
          // Geoprocessing results may change geometry type (e.g. buffer: point→polygon).
          // 'mixed' is safe — the 3-sublayer renderer handles all geometry types.
          type: 'mixed',
          style: { type: 'simple', paint: {} },
          visible: true,
          zIndex: maxZ + 1,
        })
        .returning();

      if (!newLayer) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create output layer.' });
      }

      // 6 — Run the PostGIS operation, writing into the new layer
      try {
        await runGeoprocessing(input.op, newLayer.id);
      } catch (err) {
        // Roll back the empty layer so the user doesn't see a ghost layer
        await db.delete(layers).where(eq(layers.id, newLayer.id));
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Geoprocessing failed.',
          cause: err,
        });
      }

      return { layerId: newLayer.id, layerName: newLayer.name };
    }),
});
