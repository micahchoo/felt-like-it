import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { router, publicProcedure, protectedProcedure } from '../init.js';
import { db, shares, maps, layers } from '../../db/index.js';
import { CreateShareSchema } from '@felt-like-it/shared-types';
import { requireMapOwnership } from '../../geo/access.js';
import { appendAuditLog } from '../../audit/index.js';

function generateToken(): string {
  return randomBytes(16).toString('base64url');
}

export const sharesRouter = router({
  /** Create or update a share link for a map */
  create: protectedProcedure
    .input(CreateShareSchema)
    .mutation(async ({ ctx, input }) => {
      await requireMapOwnership(ctx.user.id, input.mapId);

      // Check if share already exists for this map
      const [existing] = await db
        .select()
        .from(shares)
        .where(eq(shares.mapId, input.mapId));

      if (existing) {
        // Update access level
        const [updated] = await db
          .update(shares)
          .set({ accessLevel: input.accessLevel })
          .where(eq(shares.id, existing.id))
          .returning();

        void appendAuditLog({
          userId: ctx.user.id,
          action: 'share.update',
          entityType: 'share',
          entityId: existing.id,
          mapId: input.mapId,
          metadata: { accessLevel: input.accessLevel },
        });

        return updated;
      }

      // Create new share
      const [share] = await db
        .insert(shares)
        .values({
          mapId: input.mapId,
          token: generateToken(),
          accessLevel: input.accessLevel,
        })
        .returning();

      if (share) {
        void appendAuditLog({
          userId: ctx.user.id,
          action: 'share.create',
          entityType: 'share',
          entityId: share.id,
          mapId: input.mapId,
          metadata: { accessLevel: input.accessLevel },
        });
      }

      return share;
    }),

  /** Get share info for a map (for owners to see their share link) */
  getForMap: protectedProcedure
    .input(z.object({ mapId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await requireMapOwnership(ctx.user.id, input.mapId);

      const [share] = await db.select().from(shares).where(eq(shares.mapId, input.mapId));
      return share ?? null;
    }),

  delete: protectedProcedure
    .input(z.object({ mapId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await requireMapOwnership(ctx.user.id, input.mapId);

      void appendAuditLog({
        userId: ctx.user.id,
        action: 'share.delete',
        entityType: 'share',
        mapId: input.mapId,
      });

      await db.delete(shares).where(eq(shares.mapId, input.mapId));
      return { deleted: true };
    }),

  /** Public — resolve a share token and return map data (no auth required) */
  resolve: publicProcedure
    .input(z.object({ token: z.string() }))
    .query(async ({ input }) => {
      const [share] = await db
        .select()
        .from(shares)
        .where(eq(shares.token, input.token));

      if (!share) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share link not found or expired.' });
      }

      const [map] = await db.select().from(maps).where(eq(maps.id, share.mapId));

      if (!map) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
      }

      const mapLayers = await db
        .select()
        .from(layers)
        .where(eq(layers.mapId, map.id))
        .orderBy(layers.zIndex);

      return {
        share,
        map,
        layers: mapLayers,
      };
    }),
});
