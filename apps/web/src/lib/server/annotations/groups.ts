/**
 * Annotation groups (folders) service.
 *
 * Felt-parity Wave 2 Task 2.2. Flat CRUD today; one level of nesting is
 * allowed via parentGroupId but multi-level grouping UX is deferred. When a
 * group is deleted, its annotations' group_id becomes NULL (ON DELETE SET
 * NULL) — annotations are never cascade-deleted by group removal.
 */

import { and, eq, sql as drizzleSql, asc } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, annotationGroups } from '../db/index.js';
import { requireMapAccess } from '../geo/access.js';

export interface AnnotationGroupRow {
  id: string;
  mapId: string;
  parentGroupId: string | null;
  name: string;
  ordinal: number;
  visible: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toRow(r: typeof annotationGroups.$inferSelect): AnnotationGroupRow {
  return {
    id: r.id,
    mapId: r.mapId,
    parentGroupId: r.parentGroupId,
    name: r.name,
    ordinal: r.ordinal,
    visible: r.visible,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const annotationGroupsService = {
  async list(params: { userId: string; mapId: string }): Promise<AnnotationGroupRow[]> {
    await requireMapAccess(params.userId, params.mapId, 'viewer');
    const rows = await db
      .select()
      .from(annotationGroups)
      .where(eq(annotationGroups.mapId, params.mapId))
      .orderBy(asc(annotationGroups.ordinal), asc(annotationGroups.createdAt));
    return rows.map(toRow);
  },

  async create(params: {
    userId: string;
    mapId: string;
    name: string;
    parentGroupId?: string | null;
    visible?: boolean;
  }): Promise<AnnotationGroupRow> {
    await requireMapAccess(params.userId, params.mapId, 'editor');

    if (params.parentGroupId) {
      const [parent] = await db
        .select({ mapId: annotationGroups.mapId })
        .from(annotationGroups)
        .where(eq(annotationGroups.id, params.parentGroupId));
      if (!parent || parent.mapId !== params.mapId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Parent group does not exist on this map.',
        });
      }
    }

    // Append to the end — next ordinal = max+1 within the parent scope.
    const parentFilter = params.parentGroupId
      ? and(
          eq(annotationGroups.mapId, params.mapId),
          eq(annotationGroups.parentGroupId, params.parentGroupId),
        )
      : and(
          eq(annotationGroups.mapId, params.mapId),
          drizzleSql`${annotationGroups.parentGroupId} IS NULL`,
        );
    const [max] = await db
      .select({ v: drizzleSql<number>`COALESCE(MAX(${annotationGroups.ordinal}), -1)` })
      .from(annotationGroups)
      .where(parentFilter);
    const nextOrdinal = (max?.v ?? -1) + 1;

    const [row] = await db
      .insert(annotationGroups)
      .values({
        mapId: params.mapId,
        name: params.name,
        parentGroupId: params.parentGroupId ?? null,
        ordinal: nextOrdinal,
        visible: params.visible ?? true,
      })
      .returning();
    if (!row) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create group.' });
    }
    return toRow(row);
  },

  async update(params: {
    userId: string;
    id: string;
    name?: string;
    parentGroupId?: string | null;
    ordinal?: number;
    visible?: boolean;
  }): Promise<AnnotationGroupRow> {
    const [current] = await db
      .select({ mapId: annotationGroups.mapId })
      .from(annotationGroups)
      .where(eq(annotationGroups.id, params.id));
    if (!current) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found.' });
    }
    await requireMapAccess(params.userId, current.mapId, 'editor');

    const patch: Partial<typeof annotationGroups.$inferInsert> = { updatedAt: new Date() };
    if (params.name !== undefined) patch.name = params.name;
    if ('parentGroupId' in params) patch.parentGroupId = params.parentGroupId ?? null;
    if (params.ordinal !== undefined) patch.ordinal = params.ordinal;
    if (params.visible !== undefined) patch.visible = params.visible;

    const [row] = await db
      .update(annotationGroups)
      .set(patch)
      .where(eq(annotationGroups.id, params.id))
      .returning();
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Group not found.' });
    }
    return toRow(row);
  },

  async delete(params: { userId: string; id: string }): Promise<void> {
    const [current] = await db
      .select({ mapId: annotationGroups.mapId })
      .from(annotationGroups)
      .where(eq(annotationGroups.id, params.id));
    if (!current) {
      // Idempotent delete — no group, nothing to do.
      return;
    }
    await requireMapAccess(params.userId, current.mapId, 'editor');
    await db.delete(annotationGroups).where(eq(annotationGroups.id, params.id));
  },
};
