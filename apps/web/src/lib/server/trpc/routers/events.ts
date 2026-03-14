import { z } from 'zod';
import { eq, desc } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, mapEvents } from '../../db/index.js';
import { requireMapOwnership } from '../../geo/access.js';

export const eventsRouter = router({
  /**
   * Return recent activity events for a map, newest first.
   * Caller must own the map.
   */
  list: protectedProcedure
    .input(
      z.object({
        mapId: z.string().uuid(),
        /** Max number of events to return (1–100, default 50). */
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ ctx, input }) => {
      await requireMapOwnership(ctx.user.id, input.mapId);

      const rows = await db
        .select()
        .from(mapEvents)
        .where(eq(mapEvents.mapId, input.mapId))
        .orderBy(desc(mapEvents.createdAt))
        .limit(input.limit);

      return rows;
    }),

  /**
   * Record an activity event on behalf of the authenticated user.
   * Caller must own the map — prevents cross-map event injection.
   *
   * Called client-side after successful tRPC mutations in MapEditor
   * (e.g. after a layer import completes, after saving the viewport).
   */
  log: protectedProcedure
    .input(
      z.object({
        mapId: z.string().uuid(),
        /** Dot-namespaced action verb, e.g. 'layer.imported', 'viewport.saved'. */
        action: z.string().min(1).max(100),
        /** Optional structured payload (layer name, file name, feature count…). */
        metadata: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireMapOwnership(ctx.user.id, input.mapId);

      await db.insert(mapEvents).values({
        mapId: input.mapId,
        userId: ctx.user.id,
        action: input.action,
        metadata: input.metadata ?? null,
      });

      return { logged: true };
    }),
});
