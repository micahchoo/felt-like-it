import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, layers } from '../../db/index.js';
import { GeoprocessingOpSchema } from '@felt-like-it/shared-types';
import { getOpLayerIds } from '../../geo/geoprocessing.js';
import { requireMapAccess } from '../../geo/access.js';
import { randomUUID } from 'crypto';
import { enqueueGeoprocessingJob } from '../../jobs/queues.js';
import { sql } from 'drizzle-orm';

export const geoprocessingRouter = router({
  /**
   * Execute a geoprocessing operation and materialise the result as a new layer.
   * Returns the new layer's id and name so the client can load it immediately.
   *
   * Auth: caller must own the map. All input layers must belong to that map.
   */
  run: protectedProcedure
    .input(
      z
        .object({
          mapId: z.string().uuid(),
          op: GeoprocessingOpSchema,
          outputLayerName: z.string().min(1).max(255).trim(),
        })
        .superRefine((data, ctx) => {
          // Cross-field invariant: aggregate sum/avg require a non-empty `field`.
          // GeoprocessingOpSchema uses the base schema (not the refined export) so that
          // z.discriminatedUnion can inspect `.shape`. This superRefine is the single
          // authoritative enforcement point for that constraint.
          if (data.op.type === 'aggregate' && data.op.aggregation !== 'count' && !data.op.field) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'field is required for sum and avg aggregations.',
              path: ['op', 'field'],
            });
          }
        })
    )
    .mutation(async ({ ctx, input }) => {
      // 1 — Editor+ access required to run geoprocessing
      await requireMapAccess(ctx.user.id, input.mapId, 'editor');

      // 2 — Verify all input layers belong to this map.
      // One query per layer so eq()-only predicates work cleanly against mock columns in tests.
      const inputLayerIds = getOpLayerIds(input.op);

      await Promise.all(
        inputLayerIds.map(async (layerId) => {
          const [ownedLayer] = await db
            .select({ id: layers.id })
            .from(layers)
            .where(and(eq(layers.id, layerId), eq(layers.mapId, input.mapId)));

          if (!ownedLayer) {
            throw new TRPCError({
              code: 'NOT_FOUND',
              message: 'One or more input layers not found on this map.',
            });
          }
        })
      );

      // 3 — Determine z_index for output layer (next after current max)
      const existingLayers = await db
        .select({ zIndex: layers.zIndex })
        .from(layers)
        .where(eq(layers.mapId, input.mapId));

      const maxZ = existingLayers.reduce((max, l) => Math.max(max, l.zIndex), -1);

      // 4 — Create the output layer
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
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to create output layer.',
        });
      }

      // 5 — Enqueue async job instead of running synchronously
      const jobId = randomUUID();

      // Track job in import_jobs table for SSE progress polling
      await db.execute(sql`
        INSERT INTO import_jobs (id, map_id, status, file_name, progress)
        VALUES (${jobId}::uuid, ${input.mapId}, 'processing', ${input.outputLayerName}, 0)
      `);

      await enqueueGeoprocessingJob({
        jobId,
        mapId: input.mapId,
        op: input.op,
        outputLayerId: newLayer.id,
      });

      return { jobId, layerId: newLayer.id, layerName: newLayer.name };
    }),

  /** Cancel a running geoprocessing job. */
  cancel: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }))
    .mutation(async ({ input }) => {
      await db.execute(sql`
        UPDATE import_jobs
        SET status = 'failed', error_message = 'Cancelled by user', updated_at = NOW()
        WHERE id = ${input.jobId} AND status = 'processing'
      `);
      return { cancelled: true };
    }),
});
