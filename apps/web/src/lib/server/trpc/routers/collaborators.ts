import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { eq, and, asc } from 'drizzle-orm';
import { router, protectedProcedure } from '../init.js';
import { db, maps, users, mapCollaborators } from '../../db/index.js';
import { appendAuditLog } from '../../audit/index.js';

const ROLE_SCHEMA = z.enum(['viewer', 'commenter', 'editor']);

export const collaboratorsRouter = router({
  /**
   * List all collaborators for a map, joined with user details.
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
        .select({
          id: mapCollaborators.id,
          mapId: mapCollaborators.mapId,
          userId: mapCollaborators.userId,
          role: mapCollaborators.role,
          invitedBy: mapCollaborators.invitedBy,
          createdAt: mapCollaborators.createdAt,
          email: users.email,
          name: users.name,
        })
        .from(mapCollaborators)
        .innerJoin(users, eq(mapCollaborators.userId, users.id))
        .where(eq(mapCollaborators.mapId, input.mapId))
        .orderBy(asc(mapCollaborators.createdAt));
    }),

  /**
   * Invite a registered user by email as a collaborator.
   * Caller must own the map.
   * Throws NOT_FOUND if the email is not registered.
   * Throws CONFLICT if the user is already a collaborator.
   * Throws BAD_REQUEST if the caller tries to invite themselves.
   */
  invite: protectedProcedure
    .input(
      z.object({
        mapId: z.string().uuid(),
        email: z.string().email(),
        role: ROLE_SCHEMA.default('viewer'),
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

      const [invitee] = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.email, input.email));

      if (!invitee) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'No account found with that email.' });
      }

      if (invitee.id === ctx.user.id) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'You cannot invite yourself.' });
      }

      const [existing] = await db
        .select({ id: mapCollaborators.id })
        .from(mapCollaborators)
        .where(
          and(
            eq(mapCollaborators.mapId, input.mapId),
            eq(mapCollaborators.userId, invitee.id)
          )
        );

      if (existing) {
        throw new TRPCError({ code: 'CONFLICT', message: 'User is already a collaborator.' });
      }

      const [collab] = await db
        .insert(mapCollaborators)
        .values({
          mapId: input.mapId,
          userId: invitee.id,
          role: input.role,
          invitedBy: ctx.user.id,
        })
        .returning();

      if (!collab) {
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to add collaborator.' });
      }

      void appendAuditLog({
        userId: ctx.user.id,
        action: 'collaborator.invite',
        entityType: 'collaborator',
        entityId: collab.id,
        mapId: input.mapId,
        metadata: { role: input.role, invitedUserId: invitee.id, invitedEmail: input.email },
      });

      return collab;
    }),

  /**
   * Remove a collaborator from a map.
   * Caller must own the map.
   */
  remove: protectedProcedure
    .input(z.object({ mapId: z.string().uuid(), userId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const [map] = await db
        .select({ id: maps.id })
        .from(maps)
        .where(and(eq(maps.id, input.mapId), eq(maps.userId, ctx.user.id)));

      if (!map) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Map not found.' });
      }

      void appendAuditLog({
        userId: ctx.user.id,
        action: 'collaborator.remove',
        entityType: 'collaborator',
        mapId: input.mapId,
        metadata: { targetUserId: input.userId },
      });

      await db
        .delete(mapCollaborators)
        .where(
          and(
            eq(mapCollaborators.mapId, input.mapId),
            eq(mapCollaborators.userId, input.userId)
          )
        );

      return { removed: true };
    }),

  /**
   * Change the role of an existing collaborator.
   * Caller must own the map.
   */
  updateRole: protectedProcedure
    .input(
      z.object({
        mapId: z.string().uuid(),
        userId: z.string().uuid(),
        role: ROLE_SCHEMA,
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

      const [updated] = await db
        .update(mapCollaborators)
        .set({ role: input.role })
        .where(
          and(
            eq(mapCollaborators.mapId, input.mapId),
            eq(mapCollaborators.userId, input.userId)
          )
        )
        .returning();

      if (!updated) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Collaborator not found.' });
      }

      void appendAuditLog({
        userId: ctx.user.id,
        action: 'collaborator.updateRole',
        entityType: 'collaborator',
        entityId: updated.id,
        mapId: input.mapId,
        metadata: { role: input.role, targetUserId: input.userId },
      });

      return updated;
    }),
});
