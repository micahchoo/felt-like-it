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
  name: string | null;
  description: string | null;
  group_id: string | null;
  template_id: string | null;
  ordinal: number;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const OBJECT_COLS = sql.raw(`
  id, map_id, parent_id, author_id, author_name,
  anchor, content, name, description, group_id, template_id, ordinal, version,
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
    name: row.name,
    description: row.description,
    groupId: row.group_id,
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
    name?: string;
    description?: string;
    groupId?: string;
  }): Promise<AnnotationObject> {
    // 1. Access check (read-only, no mutation to wrap)
    await requireMapAccess(params.userId, params.mapId, 'commenter');

    // 2–5. Wrap the count check + parent validation + insert + changelog in a
    // single transaction so a failure between annotation_objects and
    // annotation_changelog rolls back both (M4). Drizzle re-throws on error —
    // the router layer's try/catch handles the propagated error unchanged.
    return await db.transaction(async (tx) => {
      // 2. Enforce per-map limit
      const countRows = await typedExecute<{ cnt: string }>(sql`
        SELECT COUNT(*)::text AS cnt FROM annotation_objects
        WHERE map_id = ${params.mapId}::uuid
      `, tx);
      if (Number(countRows[0]?.cnt ?? 0) >= MAX_ANNOTATIONS_PER_MAP) {
        throw new TRPCError({ code: 'PRECONDITION_FAILED', message: `Maximum ${MAX_ANNOTATIONS_PER_MAP} annotations per map.` });
      }

      // 3. If reply, validate parent is a root annotation
      let ordinal = 0;
      if (params.parentId) {
        const [parent] = await tx
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
        `, tx);
        ordinal = (ordRows[0]?.max_ord ?? -1) + 1;
      }

      // 4. Insert
      const anchorJson = JSON.stringify(params.anchor);
      const contentJson = JSON.stringify(params.content);

      const rows = await typedExecute<RawObjectRow>(sql`
        INSERT INTO annotation_objects (
          map_id, parent_id, author_id, author_name,
          anchor, content, name, description, group_id, template_id, ordinal
        )
        VALUES (
          ${params.mapId}::uuid,
          ${params.parentId ?? null}::uuid,
          ${params.userId}::uuid,
          ${params.userName},
          ${anchorJson}::jsonb,
          ${contentJson}::jsonb,
          ${params.name ?? null},
          ${params.description ?? null},
          ${params.groupId ?? null}::uuid,
          ${params.templateId ?? null}::uuid,
          ${ordinal}
        )
        RETURNING ${OBJECT_COLS}
      `, tx);

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
      }, tx);

      return obj;
    });
  },

  async list(params: {
    userId: string | null;
    mapId: string;
    rootsOnly?: boolean;
    cursor?: { createdAt: Date; id: string };
    limit?: number;
  }): Promise<{ items: AnnotationObject[]; totalCount: number }> {
    if (params.userId) await requireMapAccess(params.userId, params.mapId, 'viewer');

    const rootFilter = params.rootsOnly === true ? sql`AND parent_id IS NULL` : sql``;
    // Pagination keys on (created_at, id). The cursor carries created_at at JS
    // `Date` precision (millisecond); Postgres stores microsecond. Truncate the
    // column to ms on both filter and order so the strict `>` comparison is
    // stable and the last row of page N does not reappear at page N+1.
    const cursorFilter = params.cursor
      ? sql`AND (date_trunc('milliseconds', created_at), id) > (${params.cursor.createdAt}, ${params.cursor.id}::uuid)`
      : sql``;
    const limitClause = params.limit != null ? sql`LIMIT ${params.limit + 1}` : sql``;

    const [rows, countRows] = await Promise.all([
      typedExecute<RawObjectRow>(sql`
        SELECT ${OBJECT_COLS}
        FROM annotation_objects
        WHERE map_id = ${params.mapId}::uuid ${rootFilter} ${cursorFilter}
        ORDER BY date_trunc('milliseconds', created_at) ASC, id ASC
        ${limitClause}
      `),
      typedExecute<{ cnt: string }>(sql`
        SELECT COUNT(*)::text AS cnt FROM annotation_objects
        WHERE map_id = ${params.mapId}::uuid ${rootFilter}
      `),
    ]);

    const totalCount = parseInt(countRows[0]?.cnt ?? '0', 10);
    const items = params.limit != null && rows.length > params.limit
      ? rows.slice(0, params.limit)
      : rows;

    return { items: items.map(rowToObject), totalCount };
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
    content?: AnnotationObjectContent;
    anchor?: Anchor;
    /** Omit → unchanged. Explicit null → clear. String → set. */
    name?: string | null;
    description?: string | null;
    /** Omit → unchanged. Explicit null → clear (move to root). String → set. */
    groupId?: string | null;
    version: number;
  }): Promise<AnnotationObject> {
    // Wrap fetch-check-update-changelog in a single transaction (M4).
    // Preserves the existing version-check logic at step 4 unchanged —
    // W3.C's CAS refactor lands separately.
    return await db.transaction(async (tx) => {
      // 1. Fetch current
      const currentRows = await typedExecute<RawObjectRow>(sql`
        SELECT ${OBJECT_COLS} FROM annotation_objects WHERE id = ${params.id}::uuid
      `, tx);
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

      // 5. Build SET clauses — content and/or anchor may be updated
      const newVersion = current.version + 1;
      const contentJson = params.content ? JSON.stringify(params.content) : null;
      const anchorJson = params.anchor ? JSON.stringify(params.anchor) : null;

      const setClauses = [
        sql`version = ${newVersion}`,
        sql`updated_at = NOW()`,
      ];
      if (contentJson) setClauses.push(sql`content = ${contentJson}::jsonb`);
      if (anchorJson) setClauses.push(sql`anchor = ${anchorJson}::jsonb`);
      // Distinguish "omit" (undefined) from "clear" (null) via `in` check.
      if ('name' in params) setClauses.push(sql`name = ${params.name}`);
      if ('description' in params) setClauses.push(sql`description = ${params.description}`);
      if ('groupId' in params) setClauses.push(sql`group_id = ${params.groupId ?? null}::uuid`);

      const rows = await typedExecute<RawObjectRow>(sql`
        UPDATE annotation_objects
        SET ${sql.join(setClauses, sql`, `)}
        WHERE id = ${params.id}::uuid AND version = ${params.version}
        RETURNING ${OBJECT_COLS}
      `, tx);

      const row = rows[0];
      if (!row) throw new TRPCError({ code: 'CONFLICT', message: 'Version conflict — annotation was modified concurrently.' });

      const obj = rowToObject(row);

      // 6. Changelog
      const modFields: Record<string, unknown> = {};
      const oldFields: Record<string, unknown> = {};
      if (params.content) { modFields.content = params.content; oldFields.content = current.content; }
      if (params.anchor) { modFields.anchor = params.anchor; oldFields.anchor = current.anchor; }
      const { patch, inverse } = buildModPatch(modFields, oldFields);
      await insertChangelog({
        mapId: obj.mapId,
        objectId: obj.id,
        objectVersion: obj.version,
        authorId: params.userId,
        authorName: params.userName,
        operation: 'mod',
        patch,
        inverse,
      }, tx);

      return obj;
    });
  },

  async delete(params: {
    userId: string;
    userName: string;
    id: string;
    /**
     * Optional optimistic-concurrency guard (M6). When set, the DELETE is
     * conditional on `version = expectedVersion`; a stale version throws
     * CONFLICT. REST callers pass the value from the `If-Match` header;
     * tRPC and unit tests omit it to keep legacy behaviour.
     */
    expectedVersion?: number;
  }): Promise<{ deleted: true }> {
    // Wrap fetch-changelog-delete in a single transaction (M4). If the DELETE
    // step fails, the pre-written changelog row is rolled back too — no
    // orphaned 'del' changelog entry referencing an object that still exists.
    return await db.transaction(async (tx) => {
      // 1. Fetch current for snapshot
      const currentRows = await typedExecute<RawObjectRow>(sql`
        SELECT ${OBJECT_COLS} FROM annotation_objects WHERE id = ${params.id}::uuid
      `, tx);
      const current = currentRows[0];
      if (!current) throw new TRPCError({ code: 'NOT_FOUND', message: 'Annotation not found.' });

      if (current.author_id !== params.userId) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Forbidden: you can only delete your own annotations.' });
      }

      // M6: up-front version check on the fetched row. The WHERE clause in
      // step 3 would catch a race, but this signals stale If-Match clearly
      // (callers map to 412 PRECONDITION_FAILED) rather than the generic
      // CONFLICT from concurrent-delete.
      if (params.expectedVersion !== undefined && current.version !== params.expectedVersion) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Version conflict — annotation was modified.' });
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
      }, tx);

      // 3. Atomic delete with authorship check + CAS when expectedVersion set.
      const deleted = params.expectedVersion !== undefined
        ? await typedExecute<{ id: string }>(sql`
            DELETE FROM annotation_objects
            WHERE id = ${params.id}::uuid
              AND author_id = ${params.userId}::uuid
              AND version = ${params.expectedVersion}
            RETURNING id
          `, tx)
        : await typedExecute<{ id: string }>(sql`
            DELETE FROM annotation_objects
            WHERE id = ${params.id}::uuid AND author_id = ${params.userId}::uuid
            RETURNING id
          `, tx);

      if (!deleted[0]) {
        throw new TRPCError({ code: 'CONFLICT', message: 'Annotation was modified or deleted concurrently.' });
      }

      return { deleted: true };
    });
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
