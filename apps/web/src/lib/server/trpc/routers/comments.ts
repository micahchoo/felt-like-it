import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, asc } from 'drizzle-orm';
import { router, protectedProcedure, publicProcedure } from '../init.js';
import { db, maps, comments, shares } from '../../db/index.js';

export const commentsRouter = router({
  /**
   * Return all comments for a map in chronological order (oldest first).
   * Caller must own the map.
   */
  list: protectedProcedure
    .input(z.object({ mapId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const [map] = await db
        .select({ id: maps.id })
        .from(maps)
        .where(and(eq(maps.id, input.mapId), eq(maps.userId, ctx.user.id)));

      if (!map) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
      }

      return db
        .select()
        .from(comments)
        .where(eq(comments.mapId, input.mapId))
        .orderBy(asc(comments.createdAt));
    }),

  /**
   * Post a new comment on a map.
   * authorName is denormalized from the session user at insert time.
   * Caller must own the map.
   */
  create: protectedProcedure
    .input(
      z.object({
        mapId: z.string().uuid(),
        body: z.string().min(1).max(5000).trim(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [map] = await db
        .select({ id: maps.id })
        .from(maps)
        .where(and(eq(maps.id, input.mapId), eq(maps.userId, ctx.user.id)));

      if (!map) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
      }

      const [comment] = await db
        .insert(comments)
        .values({
          mapId: input.mapId,
          userId: ctx.user.id,
          authorName: ctx.user.name,
          body: input.body,
        })
        .returning();

      if (!comment) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create comment.' });
      }

      return comment;
    }),

  /**
   * Delete a comment.
   * Only the comment's author can delete their own comment
   * (enforced by matching userId in the WHERE clause — NOT_FOUND if not owner).
   */
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [comment] = await db
        .select({ id: comments.id })
        .from(comments)
        .where(and(eq(comments.id, input.id), eq(comments.userId, ctx.user.id)));

      if (!comment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found.' });
      }

      await db.delete(comments).where(eq(comments.id, input.id));
      return { deleted: true };
    }),

  /**
   * Toggle the resolved state of a comment.
   * Only the map owner can resolve/unresolve comments (moderation).
   */
  resolve: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [comment] = await db
        .select({ id: comments.id, mapId: comments.mapId, resolved: comments.resolved })
        .from(comments)
        .where(eq(comments.id, input.id));

      if (!comment) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Comment not found.' });
      }

      const [map] = await db
        .select({ id: maps.id })
        .from(maps)
        .where(and(eq(maps.id, comment.mapId), eq(maps.userId, ctx.user.id)));

      if (!map) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Only the map owner can resolve comments.' });
      }

      const [updated] = await db
        .update(comments)
        .set({ resolved: !comment.resolved, updatedAt: new Date() })
        .where(eq(comments.id, input.id))
        .returning();

      if (!updated) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to update comment.' });
      }

      return updated;
    }),

  /**
   * List all comments for a shared map.
   * Public — no authentication required; validated via share token.
   */
  listForShare: publicProcedure
    .input(z.object({ shareToken: z.string().min(1).max(255) }))
    .query(async ({ input }) => {
      const [share] = await db
        .select({ mapId: shares.mapId })
        .from(shares)
        .where(eq(shares.token, input.shareToken));

      if (!share) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share link not found.' });
      }

      return db
        .select()
        .from(comments)
        .where(eq(comments.mapId, share.mapId))
        .orderBy(asc(comments.createdAt));
    }),

  /**
   * Post a guest comment on a shared map.
   * Public — no authentication required; validated via share token.
   * userId is stored as null; authorName is provided by the caller.
   */
  createForShare: publicProcedure
    .input(
      z.object({
        shareToken: z.string().min(1).max(255),
        authorName: z.string().min(1).max(100).trim(),
        body: z.string().min(1).max(5000).trim(),
      })
    )
    .mutation(async ({ input }) => {
      const [share] = await db
        .select({ mapId: shares.mapId })
        .from(shares)
        .where(eq(shares.token, input.shareToken));

      if (!share) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share link not found.' });
      }

      const [comment] = await db
        .insert(comments)
        .values({
          mapId: share.mapId,
          userId: null,
          authorName: input.authorName,
          body: input.body,
        })
        .returning();

      if (!comment) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create comment.' });
      }

      return comment;
    }),
});
