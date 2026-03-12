import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, desc, asc, count } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, maps, layers, mapCollaborators } from '../../db/index.js';
import { CreateMapSchema, UpdateMapSchema } from '@felt-like-it/shared-types';
import { appendAuditLog } from '../../audit/index.js';
import { createMap, deleteMap, cloneMap, createFromTemplate } from '../../maps/operations.js';

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
        createdAt: maps.createdAt,
        updatedAt: maps.updatedAt,
      })
      .from(maps)
      .where(eq(maps.userId, userId))
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
        .where(eq(maps.id, input.id));

      if (!map) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
      }

      // Owner sees the map immediately; collaborators (viewer+) may also access it.
      if (map.userId !== ctx.user.id) {
        const [collab] = await db
          .select({ role: mapCollaborators.role })
          .from(mapCollaborators)
          .where(and(eq(mapCollaborators.mapId, input.id), eq(mapCollaborators.userId, ctx.user.id)));

        if (!collab) {
          throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
        }
        // All collaborator roles (viewer / commenter / editor) can fetch the map.
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
      return createMap(ctx.user.id, input.title, input.description);
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

      void appendAuditLog({
        userId: ctx.user.id,
        action: 'map.update',
        entityType: 'map',
        entityId: id,
        mapId: id,
        metadata: {
          changedFields: Object.keys(data).filter(
            (k) => data[k as keyof typeof data] !== undefined,
          ),
        },
      });

      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return deleteMap(ctx.user.id, input.id);
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

  createFromTemplate: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return createFromTemplate(ctx.user.id, input.id);
    }),

  /** Deep-clone a map: copies the map record, all layers, and all features. */
  clone: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      return cloneMap(ctx.user.id, input.id);
    }),

  /**
   * List maps the caller has been invited to collaborate on (not their own maps).
   * Returns each map's metadata plus the caller's role.
   */
  listCollaborating: protectedProcedure.query(async ({ ctx }) => {
    const rows = await db
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
      .innerJoin(maps, eq(maps.id, mapCollaborators.mapId))
      .where(eq(mapCollaborators.userId, ctx.user.id))
      .orderBy(desc(maps.updatedAt));

    return rows;
  }),
});
