import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { typedExecute, type SqlExecutor } from '../geo/queries.js';
import type { AnnotationObject } from '@felt-like-it/shared-types';

// ─── Patch types ─────────────────────────────────────────────────────────────

interface AddPatch {
  op: 'add';
  object: Record<string, unknown>;
}

interface ModPatch {
  op: 'mod';
  attrs: Record<string, unknown>;
}

interface DelPatch {
  op: 'del';
  object_id: string;
}

interface AddInverse {
  op: 'add';
  object: Record<string, unknown>;
}

type Patch = AddPatch | ModPatch | DelPatch;
type Inverse = AddInverse | ModPatch | DelPatch;

// ─── Snapshot helper ─────────────────────────────────────────────────────────

function objectSnapshot(obj: AnnotationObject): Record<string, unknown> {
  return {
    id: obj.id,
    mapId: obj.mapId,
    parentId: obj.parentId,
    authorId: obj.authorId,
    authorName: obj.authorName,
    anchor: obj.anchor,
    content: obj.content,
    templateId: obj.templateId,
    ordinal: obj.ordinal,
    version: obj.version,
    createdAt: obj.createdAt instanceof Date ? obj.createdAt.toISOString() : String(obj.createdAt),
    updatedAt: obj.updatedAt instanceof Date ? obj.updatedAt.toISOString() : String(obj.updatedAt),
  };
}

// ─── Patch builders ──────────────────────────────────────────────────────────

export function buildAddPatch(obj: AnnotationObject): { patch: AddPatch; inverse: DelPatch } {
  return {
    patch: { op: 'add', object: objectSnapshot(obj) },
    inverse: { op: 'del', object_id: obj.id },
  };
}

export function buildModPatch(
  newAttrs: Record<string, unknown>,
  oldAttrs: Record<string, unknown>,
): { patch: ModPatch; inverse: ModPatch } {
  return {
    patch: { op: 'mod', attrs: newAttrs },
    inverse: { op: 'mod', attrs: oldAttrs },
  };
}

export function buildDelPatch(obj: AnnotationObject): { patch: DelPatch; inverse: AddInverse } {
  return {
    patch: { op: 'del', object_id: obj.id },
    inverse: { op: 'add', object: objectSnapshot(obj) },
  };
}

// ─── Insert changelog entry ──────────────────────────────────────────────────

export async function insertChangelog(
  params: {
    mapId: string;
    objectId: string;
    objectVersion: number;
    authorId: string;
    authorName: string;
    operation: 'add' | 'mod' | 'del';
    patch: Patch;
    inverse: Inverse;
  },
  executor: SqlExecutor = db,
): Promise<string> {
  const rows = await executor.execute(sql`
    INSERT INTO annotation_changelog (
      map_id, object_id, object_version, author_id, author_name,
      operation, patch, inverse
    )
    VALUES (
      ${params.mapId}::uuid,
      ${params.objectId}::uuid,
      ${params.objectVersion},
      ${params.authorId}::uuid,
      ${params.authorName},
      ${params.operation},
      ${JSON.stringify(params.patch)}::jsonb,
      ${JSON.stringify(params.inverse)}::jsonb
    )
    RETURNING id
  `);
  const row = (rows.rows as Array<{ id: string }>)[0];
  if (!row) throw new Error('Failed to insert changelog entry');
  return row.id;
}

// ─── Read changelog entries ─────────────────────────────────────────────────

export interface ChangelogEntry {
  id: string;
  mapId: string;
  objectId: string;
  objectVersion: number;
  authorId: string | null;
  authorName: string;
  operation: 'add' | 'mod' | 'del';
  patch: Record<string, unknown>;
  inverse: Record<string, unknown>;
  createdAt: string;
}

interface RawChangelogRow {
  id: string;
  map_id: string;
  object_id: string;
  object_version: number;
  author_id: string | null;
  author_name: string;
  operation: string;
  patch: Record<string, unknown>;
  inverse: Record<string, unknown>;
  created_at: Date;
}

function rowToEntry(row: RawChangelogRow): ChangelogEntry {
  return {
    id: row.id,
    mapId: row.map_id,
    objectId: row.object_id,
    objectVersion: row.object_version,
    authorId: row.author_id,
    authorName: row.author_name,
    operation: row.operation as ChangelogEntry['operation'],
    patch: row.patch,
    inverse: row.inverse,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/**
 * Fetch changelog entries for a specific annotation object.
 * Returns newest-first with cursor-based pagination keyed on (created_at, id).
 */
export async function getChangelog(params: {
  objectId: string;
  limit: number;
  cursor?: string; // changelog entry UUID — fetch entries older than this
}): Promise<{ items: ChangelogEntry[]; nextCursor: string | null }> {
  const cursorFilter = params.cursor
    ? sql`AND (cl.created_at, cl.id) < (
        SELECT created_at, id FROM annotation_changelog WHERE id = ${params.cursor}::uuid
      )`
    : sql``;

  // Fetch limit + 1 to detect whether more pages exist
  const rows = await typedExecute<RawChangelogRow>(sql`
    SELECT
      id, map_id, object_id, object_version, author_id, author_name,
      operation, patch, inverse, created_at
    FROM annotation_changelog cl
    WHERE object_id = ${params.objectId}::uuid
    ${cursorFilter}
    ORDER BY created_at DESC, id DESC
    LIMIT ${params.limit + 1}
  `);

  const hasMore = rows.length > params.limit;
  const items = hasMore ? rows.slice(0, params.limit) : rows;
  const nextCursor = hasMore ? items[items.length - 1]!.id : null;

  return {
    items: items.map(rowToEntry),
    nextCursor,
  };
}

/**
 * Look up the map_id for a changelog entry's object.
 * Uses the changelog table itself (not annotation_objects) since
 * the object may have been deleted.
 */
export async function getChangelogMapId(objectId: string): Promise<string | null> {
  const rows = await typedExecute<{ map_id: string }>(sql`
    SELECT map_id FROM annotation_changelog
    WHERE object_id = ${objectId}::uuid
    LIMIT 1
  `);
  return rows[0]?.map_id ?? null;
}
