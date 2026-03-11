import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
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
    createdAt: obj.createdAt.toISOString(),
    updatedAt: obj.updatedAt.toISOString(),
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

export async function insertChangelog(params: {
  mapId: string;
  objectId: string;
  objectVersion: number;
  authorId: string;
  authorName: string;
  operation: 'add' | 'mod' | 'del';
  patch: Patch;
  inverse: Inverse;
}): Promise<string> {
  const rows = await db.execute(sql`
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
