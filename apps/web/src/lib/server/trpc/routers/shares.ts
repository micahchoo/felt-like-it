import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { router, publicProcedure, protectedProcedure } from '../init.js';
import { db, shares } from '../../db/index.js';
import { CreateShareSchema } from '@felt-like-it/shared-types';
import { requireMapOwnership } from '../../geo/access.js';
import { resolveShareToken } from '../../auth/resolve-share-token.js';
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

      // F13.3 — null vs undefined matters: explicit null clears any prior
      // expiration; undefined leaves the column unchanged on update.
      const expiresAtValue =
        input.expiresAt === undefined
          ? undefined
          : input.expiresAt === null
            ? null
            : new Date(input.expiresAt);

      if (existing) {
        // Update access level (+ optional expiration)
        const [updated] = await db
          .update(shares)
          .set({
            accessLevel: input.accessLevel,
            ...(expiresAtValue !== undefined ? { expiresAt: expiresAtValue } : {}),
          })
          .where(eq(shares.id, existing.id))
          .returning();

        void appendAuditLog({
          userId: ctx.user.id,
          action: 'share.update',
          entityType: 'share',
          entityId: existing.id,
          mapId: input.mapId,
          metadata: { accessLevel: input.accessLevel, expiresAt: input.expiresAt ?? null },
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
          ...(expiresAtValue !== undefined ? { expiresAt: expiresAtValue } : {}),
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
      const result = await resolveShareToken(input.token);
      if (result.kind === 'not_found') {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share link not found.' });
      }
      if (result.kind === 'expired') {
        // F13.3 — distinct error for expired links. tRPC has no native
        // 410 Gone code; PRECONDITION_FAILED carries the right "the
        // resource exists but is no longer valid" semantics + lets the
        // UI distinguish from a true NOT_FOUND.
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message: `Share link expired on ${result.expiredAt.toISOString()}.`,
        });
      }
      return {
        share: result.share,
        map: result.map,
        layers: result.layers,
      };
    }),
});
