import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, asc, desc, lt, sql } from 'drizzle-orm';
import { router, protectedProcedure, publicProcedure } from '../init.js';
import { db, comments, shares } from '../../db/index.js';
import { requireMapAccess, requireMapOwnership } from '../../geo/access.js';
import { createRateLimiter } from '../../rate-limit.js';

/** 10 guest comments per share token per minute. */
const guestCommentLimiter = createRateLimiter({ windowMs: 60_000, maxRequests: 10 });

/** Shared pagination fields — optional so callers without them get the old flat-array behavior. */
const paginationInput = {
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().uuid().optional(),
};

export const commentsRouter = router({
  /**
   * Return comments for a map in chronological order (oldest first).
   * When `limit` is provided, returns a paginated response with `nextCursor`.
   * When omitted, returns the flat array (backward-compatible).
   * Viewer+ access required.
   */
  list: protectedProcedure
    .input(z.object({ mapId: z.string().uuid(), ...paginationInput }))
    .query(async ({ ctx, input }) => {
      await requireMapAccess(ctx.user.id, input.mapId, 'viewer');

      if (input.limit == null) {
        // Backward-compatible: return flat array.
        return db
          .select()
          .from(comments)
          .where(eq(comments.mapId, input.mapId))
          .orderBy(asc(comments.createdAt));
      }

      const conditions = [eq(comments.mapId, input.mapId)];
      if (input.cursor) {
        conditions.push(
          lt(
            comments.createdAt,
            sql`(SELECT ${comments.createdAt} FROM ${comments} WHERE ${comments.id} = ${input.cursor})`,
          ),
        );
      }

      const rows = await db
        .select()
        .from(comments)
        .where(and(...conditions))
        .orderBy(desc(comments.createdAt))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]!.id : undefined,
      };
    }),

  /**
   * Post a new comment on a map.
   * authorName is denormalized from the session user at insert time.
   * Commenter+ access required.
   */
  create: protectedProcedure
    .input(
      z.object({
        mapId: z.string().uuid(),
        body: z.string().min(1).max(5000).trim(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireMapAccess(ctx.user.id, input.mapId, 'commenter');

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

      await requireMapOwnership(ctx.user.id, comment.mapId);

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
   * List comments for a shared map.
   * When `limit` is provided, returns a paginated response with `nextCursor`.
   * When omitted, returns the flat array (backward-compatible).
   * Public — no authentication required; validated via share token.
   */
  listForShare: publicProcedure
    .input(z.object({ shareToken: z.string().min(1).max(255), ...paginationInput }))
    .query(async ({ input }) => {
      const [share] = await db
        .select({ mapId: shares.mapId })
        .from(shares)
        .where(eq(shares.token, input.shareToken));

      if (!share) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Share link not found.' });
      }

      if (input.limit == null) {
        // Backward-compatible: return flat array.
        return db
          .select()
          .from(comments)
          .where(eq(comments.mapId, share.mapId))
          .orderBy(asc(comments.createdAt));
      }

      const conditions = [eq(comments.mapId, share.mapId)];
      if (input.cursor) {
        conditions.push(
          lt(
            comments.createdAt,
            sql`(SELECT ${comments.createdAt} FROM ${comments} WHERE ${comments.id} = ${input.cursor})`,
          ),
        );
      }

      const rows = await db
        .select()
        .from(comments)
        .where(and(...conditions))
        .orderBy(desc(comments.createdAt))
        .limit(input.limit + 1);

      const hasMore = rows.length > input.limit;
      const items = hasMore ? rows.slice(0, input.limit) : rows;
      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]!.id : undefined,
      };
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
      if (!(await guestCommentLimiter.check(input.shareToken))) {
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: 'Too many comments. Please wait a moment before posting again.',
        });
      }

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
