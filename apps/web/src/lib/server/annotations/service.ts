import { sql, eq } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { db, annotationObjects } from '../db/index.js';
import { requireMapAccess } from '../geo/access.js';
import { typedExecute } from '../geo/queries.js';
import {
  buildAddPatch,
  buildModPatch,
  buildDelPatch,
  insertChangelog,
} from './changelog.js';
import type {
  Anchor,
  AnnotationObject,
  AnnotationObjectContent,
} from '@felt-like-it/shared-types';

// ─── Raw DB row (snake_case from SQL) ────────────────────────────────────────

interface RawObjectRow {
  id: string;
  map_id: string;
  parent_id: string | null;
  author_id: string | null;
  author_name: string;
  anchor: Anchor;
  content: AnnotationObjectContent;
  template_id: string | null;
  ordinal: number;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const OBJECT_COLS = sql.raw(`
  id, map_id, parent_id, author_id, author_name,
  anchor, content, template_id, ordinal, version,
  created_at, updated_at
`);

function rowToObject(row: RawObjectRow): AnnotationObject {
  return {
    id: row.id,
    mapId: row.map_id,
    parentId: row.parent_id,
    authorId: row.author_id,
    authorName: row.author_name,
    anchor: row.anchor,
    content: row.content,
    templateId: row.template_id,
    ordinal: row.ordinal,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Limits ──────────────────────────────────────────────────────────────────

const MAX_ANNOTATIONS_PER_MAP = 10_000;

// ─── Service ─────────────────────────────────────────────────────────────────

export const annotationService = {
  async create(params: {
    userId: string;
    userName: string;
    mapId: string;
    parentId?: string;
    anchor: Anchor;
    content: AnnotationObjectContent;
    templateId?: string;
  }): Promise<AnnotationObject> {
    // 1. Access check
    await requireMapAccess(params.userId, params.mapId, 'commenter');

    // 2. Enforce per-map limit
    const countRows = await typedExecute<{ cnt: string }>(sql`
      SELECT COUNT(*)::text AS cnt FROM annotation_objects
      WHERE map_id = ${params.mapId}::uuid
    `);
    if (Number(countRows[0]?.cnt ?? 0) >= MAX_ANNOTATIONS_PER_MAP) {
      throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Maximum ${MAX_ANNOTATIONS_PER_MAP} annotations per map.` });
    }

    // 3. If reply, validate parent is a root annotation
    let ordinal = 0;
    if (params.parentId) {
      const [parent] = await db
        .select({ parentId: annotationObjects.parentId })
        .from(annotationObjects)
        .where(eq(annotationObjects.id, params.parentId));

      if (!parent) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Parent annotation not found.' });
      }
      if (parent.parentId !== null) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Replies can only target a root annotation.' });
      }

      // Get next ordinal
      const ordRows = await typedExecute<{ max_ord: number | null }>(sql`
        SELECT MAX(ordinal) AS max_ord FROM annotation_objects
        WHERE parent_id = ${params.parentId}::uuid
      `);
      ordinal = (ordRows[0]?.max_ord ?? -1) + 1;
    }

    // 4. Insert
    const anchorJson = JSON.stringify(params.anchor);
    const contentJson = JSON.stringify(params.content);

    const rows = await typedExecute<RawObjectRow>(sql`
      INSERT INTO annotation_objects (
        map_id, parent_id, author_id, author_name,
        anchor, content, template_id, ordinal
      )
      VALUES (
        ${params.mapId}::uuid,
        ${params.parentId ?? null}::uuid,
        ${params.userId}::uuid,
        ${params.userName},
        ${anchorJson}::jsonb,
        ${contentJson}::jsonb,
        ${params.templateId ?? null}::uuid,
        ${ordinal}
      )
      RETURNING ${OBJECT_COLS}
    `);

    const row = rows[0];
    if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Insert failed.' });

    const obj = rowToObject(row);

    // 5. Changelog
    const { patch, inverse } = buildAddPatch(obj);
    await insertChangelog({
      mapId: obj.mapId,
      objectId: obj.id,
      objectVersion: obj.version,
      authorId: params.userId,
      authorName: params.userName,
      operation: 'add',
      patch,
      inverse,
    });

    return obj;
  },

  async list(params: {
    userId: string;
    mapId: string;
    rootsOnly?: boolean;
  }): Promise<AnnotationObject[]> {
    await requireMapAccess(params.userId, params.mapId, 'viewer');

    const whereClause = params.rootsOnly === true
      ? sql`WHERE map_id = ${params.mapId}::uuid AND parent_id IS NULL`
      : sql`WHERE map_id = ${params.mapId}::uuid`;

    const rows = await typedExecute<RawObjectRow>(sql`
      SELECT ${OBJECT_COLS}
      FROM annotation_objects
      ${whereClause}
      ORDER BY created_at ASC
    `);

    return rows.map(rowToObject);
  },

  async get(params: {
    userId: string;
    id: string;
  }): Promise<AnnotationObject> {
    const rows = await typedExecute<RawObjectRow>(sql`
      SELECT ${OBJECT_COLS} FROM annotation_objects WHERE id = ${params.id}::uuid
    `);
    const row = rows[0];
    if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'Annotation not found.' });

    await requireMapAccess(params.userId, row.map_id, 'viewer');
    return rowToObject(row);
  },

  async getThread(params: {
    userId: string;
    rootId: string;
  }): Promise<{ root: AnnotationObject; replies: AnnotationObject[] }> {
    const root = await this.get({ userId: params.userId, id: params.rootId });
    if (root.parentId !== null) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Not a root annotation.' });
    }

    const rows = await typedExecute<RawObjectRow>(sql`
      SELECT ${OBJECT_COLS} FROM annotation_objects
      WHERE parent_id = ${params.rootId}::uuid
      ORDER BY ordinal ASC
    `);

    return { root, replies: rows.map(rowToObject) };
  },

  async update(params: {
    userId: string;
    userName: string;
    id: string;
    content: AnnotationObjectContent;
    version: number;
  }): Promise<AnnotationObject> {
    // 1. Fetch current
    const currentRows = await typedExecute<RawObjectRow>(sql`
      SELECT ${OBJECT_COLS} FROM annotation_objects WHERE id = ${params.id}::uuid
    `);
    const current = currentRows[0];
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Annotation not found.' });

    // 2. Authorship
    if (current.author_id !== params.userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'You can only edit your own annotations.' });
    }

    // 3. Access check
    await requireMapAccess(params.userId, current.map_id, 'commenter');

    // 4. Optimistic concurrency
    if (current.version !== params.version) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Version conflict — annotation was modified by another user.' });
    }

    // 5. Update with version guard
    const contentJson = JSON.stringify(params.content);
    const newVersion = current.version + 1;

    const rows = await typedExecute<RawObjectRow>(sql`
      UPDATE annotation_objects
      SET content = ${contentJson}::jsonb,
          version = ${newVersion},
          updated_at = NOW()
      WHERE id = ${params.id}::uuid AND version = ${params.version}
      RETURNING ${OBJECT_COLS}
    `);

    const row = rows[0];
    if (!row) throw new TRPCError({ code: 'CONFLICT', message: 'Version conflict — annotation was modified concurrently.' });

    const obj = rowToObject(row);

    // 5. Changelog
    const { patch, inverse } = buildModPatch(
      { content: params.content },
      { content: current.content },
    );
    await insertChangelog({
      mapId: obj.mapId,
      objectId: obj.id,
      objectVersion: obj.version,
      authorId: params.userId,
      authorName: params.userName,
      operation: 'mod',
      patch,
      inverse,
    });

    return obj;
  },

  async delete(params: {
    userId: string;
    userName: string;
    id: string;
  }): Promise<{ deleted: true }> {
    // 1. Fetch current for snapshot
    const currentRows = await typedExecute<RawObjectRow>(sql`
      SELECT ${OBJECT_COLS} FROM annotation_objects WHERE id = ${params.id}::uuid
    `);
    const current = currentRows[0];
    if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Annotation not found.' });

    if (current.author_id !== params.userId) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Forbidden: you can only delete your own annotations.' });
    }

    await requireMapAccess(params.userId, current.map_id, 'commenter');

    const obj = rowToObject(current);

    // 2. Changelog BEFORE delete (so snapshot is preserved)
    const { patch, inverse } = buildDelPatch(obj);
    await insertChangelog({
      mapId: obj.mapId,
      objectId: obj.id,
      objectVersion: obj.version,
      authorId: params.userId,
      authorName: params.userName,
      operation: 'del',
      patch,
      inverse,
    });

    // 3. Atomic delete with authorship check (cascades to children via FK)
    const deleted = await typedExecute<{ id: string }>(sql`
      DELETE FROM annotation_objects
      WHERE id = ${params.id}::uuid AND author_id = ${params.userId}::uuid
      RETURNING id
    `);

    if (!deleted[0]) {
      throw new TRPCError({ code: 'CONFLICT', message: 'Annotation was modified or deleted concurrently.' });
    }

    return { deleted: true };
  },

  /**
   * Convert a feature-anchored (orphaned) annotation's anchor to a plain point.
   * Replaces the entire anchor with a point anchor at the given coordinates.
   * Map access is checked at the router layer (editor role required).
   */
  async convertAnchorToPoint(
    annotationId: string,
    mapId: string,
    coordinates: [number, number],
  ): Promise<void> {
    const anchorJson = JSON.stringify({
      type: 'point',
      geometry: { type: 'Point', coordinates },
    });

    await typedExecute<{ id: string }>(sql`
      UPDATE annotation_objects
      SET anchor = ${anchorJson}::jsonb,
          updated_at = NOW()
      WHERE id = ${annotationId}::uuid AND map_id = ${mapId}::uuid
    `);
  },

  /**
   * Flag feature-anchored annotations as orphaned after their features are deleted.
   * Sets `anchor.featureDeleted = true` on any annotation whose anchor references
   * one of the given feature IDs.
   */
  async flagOrphanedAnnotations(featureIds: string[]): Promise<number> {
    if (featureIds.length === 0) return 0;

    const result = await typedExecute<{ id: string }>(sql`
      UPDATE annotation_objects
      SET anchor = jsonb_set(anchor, '{featureDeleted}', 'true'),
          updated_at = NOW()
      WHERE anchor->>'type' = 'feature'
        AND anchor->>'featureId' = ANY(${featureIds})
        AND (anchor->>'featureDeleted' IS NULL OR anchor->>'featureDeleted' = 'false')
      RETURNING id
    `);

    return result.length;
  },
};
