import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  bigserial,
  jsonb,
  uuid,
  index,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { Viewport, LayerStyle } from '@felt-like-it/shared-types';
import type { AnnotationContent } from '@felt-like-it/shared-types';
import type { Anchor, AnnotationObjectContent } from '@felt-like-it/shared-types';

// Custom PostGIS geometry type — mixed geometry (Point / LineString / Polygon / etc.)
// Always read via ST_AsGeoJSON; always written via ST_GeomFromGeoJSON in raw SQL.
export const geometryType = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(Geometry, 4326)',
});

// Custom PostGIS point type — used for annotation anchors.
// Always read via ST_X(col) / ST_Y(col); written via ST_GeomFromGeoJSON.
export const geometryPointType = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(Point, 4326)',
});

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    hashedPassword: text('hashed_password').notNull(),
    name: text('name').notNull(),
    isAdmin: boolean('is_admin').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    disabledAt: timestamp('disabled_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)]
);

// ─── Sessions (Lucia auth — ID is text, not UUID) ─────────────────────────────
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
});

// ─── Maps ─────────────────────────────────────────────────────────────────────
export const maps = pgTable(
  'maps',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    viewport: jsonb('viewport').$type<Viewport>()
      .notNull()
      .default(sql`'{"center":[-98.35,39.5],"zoom":4,"bearing":0,"pitch":0}'::jsonb`),
    basemap: text('basemap').notNull().default('osm'),
    /**
     * Template maps are visible to all users via maps.listTemplates and can be cloned
     * as a starting point for a new map (see maps.createFromTemplate).
     * Managed by admins / seeded — not settable by regular users via tRPC.
     */
    isTemplate: boolean('is_template').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('maps_user_id_idx').on(t.userId)]
);

// ─── Layers ───────────────────────────────────────────────────────────────────
export const layers = pgTable(
  'layers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // 'point' | 'line' | 'polygon' | 'mixed'
    type: text('type').notNull().default('mixed'),
    style: jsonb('style').$type<LayerStyle>().notNull().default(sql`'{}'::jsonb`),
    visible: boolean('visible').notNull().default(true),
    zIndex: integer('z_index').notNull().default(0),
    sourceFileName: text('source_file_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('layers_map_id_idx').on(t.mapId)]
);

// ─── Features ─────────────────────────────────────────────────────────────────
export const features = pgTable(
  'features',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    layerId: uuid('layer_id')
      .notNull()
      .references(() => layers.id, { onDelete: 'cascade' }),
    // PostGIS geometry(Geometry, 4326)
    // Reading: always wrap with ST_AsGeoJSON(geometry)
    // Writing: always use ST_GeomFromGeoJSON(?)
    geometry: geometryType('geometry').notNull(),
    properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('features_layer_id_idx').on(t.layerId),
    // Spatial index for geo queries
    index('features_geometry_idx').using('gist', t.geometry),
  ]
);

// ─── Share Links ──────────────────────────────────────────────────────────────
export const shares = pgTable(
  'shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    // 'public' | 'unlisted'
    accessLevel: text('access_level').notNull().default('unlisted'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('shares_token_idx').on(t.token),
    index('shares_map_id_idx').on(t.mapId),
  ]
);

// ─── Map Collaborators (granular permissions) ─────────────────────────────────
export const mapCollaborators = pgTable(
  'map_collaborators',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** 'viewer' | 'commenter' | 'editor' */
    role: text('role').notNull().default('viewer'),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('map_collaborators_map_user_idx').on(t.mapId, t.userId),
    index('map_collaborators_map_id_idx').on(t.mapId),
    index('map_collaborators_user_id_idx').on(t.userId),
  ]
);

// ─── Comment Threads ──────────────────────────────────────────────────────────
export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    /** Null when the author's account has been deleted. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Author name denormalized at insert time so comments survive user deletion
     * and no JOIN is required when listing comments.
     */
    authorName: text('author_name').notNull(),
    body: text('body').notNull(),
    /** Map owner can mark a comment thread as resolved (addressed). */
    resolved: boolean('resolved').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('comments_map_id_idx').on(t.mapId),
    index('comments_created_at_idx').on(t.createdAt),
  ]
);

// ─── Map Events (activity feed) ───────────────────────────────────────────────
export const mapEvents = pgTable(
  'map_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    /** Null when the originating user account has been deleted. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Action identifier — dot-namespaced verb (e.g. 'layer.imported',
     * 'viewport.saved', 'feature.drawn').
     */
    action: text('action').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('map_events_map_id_idx').on(t.mapId),
    index('map_events_created_at_idx').on(t.createdAt),
  ]
);

// ─── Annotations ──────────────────────────────────────────────────────────────
export const annotations = pgTable(
  'annotations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    /**
     * Null when the originating user account has been deleted.
     * Mirrors the `comments.userId` nullable FK pattern.
     */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /**
     * Author name denormalized at insert time (mirrors `comments.authorName`).
     * Survives user deletion; no JOIN is required when listing annotations.
     */
    authorName: text('author_name').notNull(),
    /**
     * Geographic anchor: PostGIS geometry(Point, 4326).
     *
     * Reading: use ST_X(anchor_point) for longitude, ST_Y(anchor_point) for latitude.
     * Writing: use ST_GeomFromGeoJSON('{"type":"Point","coordinates":[lng,lat]}').
     */
    anchorPoint: geometryPointType('anchor_point').notNull(),
    /**
     * Annotation content as JSONB — AnnotationContentSchema discriminated union.
     * The `type` field ('text'|'emoji'|'gif'|'image'|'link'|'iiif') is always present.
     * Validated by the application layer (Zod) before any DB write.
     */
    content: jsonb('content').$type<AnnotationContent>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Composite index: the primary query pattern is map-scoped chronological listing
    index('annotations_map_id_created_at_idx').on(t.mapId, t.createdAt),
    // Spatial index for future proximity queries (ST_DWithin / KNN)
    index('annotations_anchor_point_idx').using('gist', t.anchorPoint),
  ]
);

// ─── Annotation Objects (v2) ─────────────────────────────────────────────────
// Penpot-inspired flat object store. Replaces `annotations` table after migration.

export const annotationObjects = pgTable(
  'annotation_objects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id').references((): AnyPgColumn => annotationObjects.id, {
      onDelete: 'cascade',
    }),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull(),
    anchor: jsonb('anchor').$type<Anchor>().notNull(),
    content: jsonb('content').$type<AnnotationObjectContent>().notNull(),
    templateId: uuid('template_id'),
    ordinal: integer('ordinal').notNull().default(0),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('annotation_objects_map_created_idx').on(t.mapId, t.createdAt),
    index('annotation_objects_thread_idx').on(t.mapId, t.parentId, t.ordinal),
    index('annotation_objects_template_idx').on(t.templateId),
  ]
);

export const annotationChangelog = pgTable(
  'annotation_changelog',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id').notNull(),
    objectVersion: integer('object_version').notNull(),
    authorId: uuid('author_id').references(() => users.id, { onDelete: 'set null' }),
    authorName: text('author_name').notNull(),
    operation: text('operation').notNull(), // 'add' | 'mod' | 'del'
    patch: jsonb('patch').notNull(),
    inverse: jsonb('inverse').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('annotation_changelog_map_time_idx').on(t.mapId, t.createdAt),
    index('annotation_changelog_object_idx').on(t.objectId, t.createdAt),
    index('annotation_changelog_undo_idx').on(t.mapId, t.authorId, t.createdAt),
  ]
);

// ─── Audit Log ────────────────────────────────────────────────────────────────
export const auditLog = pgTable(
  'audit_log',
  {
    /**
     * Monotonic BIGSERIAL — used to impose a total order on the hash chain.
     * JavaScript number is safe up to 2^53; we'll never exceed that.
     */
    seq: bigserial('seq', { mode: 'number' }).primaryKey(),
    /** Null when the originating user account has been deleted. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    /** Dot-namespaced action verb — e.g. 'map.create', 'collaborator.invite'. */
    action: text('action').notNull(),
    /** Top-level entity kind: 'map', 'share', 'collaborator', 'apiKey'. */
    entityType: text('entity_type').notNull(),
    /** UUID (or other ID) of the affected entity, stored as text for flexibility. */
    entityId: text('entity_id'),
    /** Map this mutation belongs to. Null for account-level events (e.g. apiKey). */
    mapId: uuid('map_id').references(() => maps.id, { onDelete: 'set null' }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    /** chain_hash of the previous row; 64 zeros ('0'×64) for the first entry. */
    prevHash: text('prev_hash').notNull(),
    /** SHA-256(JSON.stringify(content) + prevHash) — tamper-detection hash. */
    chainHash: text('chain_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('audit_log_map_id_idx').on(t.mapId),
    index('audit_log_user_id_idx').on(t.userId),
    index('audit_log_created_at_idx').on(t.createdAt),
  ]
);

// ─── API Keys ─────────────────────────────────────────────────────────────────
export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /**
     * SHA-256 hex digest of the raw "flk_<64-hex>" key.
     * The plaintext is never stored — only returned once at creation time.
     */
    keyHash: text('key_hash').notNull(),
    /** First 12 characters of the raw key (e.g. "flk_a1b2c3d4") — displayed in the UI. */
    prefix: text('prefix').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('api_keys_key_hash_idx').on(t.keyHash),
    index('api_keys_user_id_idx').on(t.userId),
  ]
);

// ─── Import Jobs ──────────────────────────────────────────────────────────────
export const importJobs = pgTable(
  'import_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    mapId: uuid('map_id')
      .notNull()
      .references(() => maps.id, { onDelete: 'cascade' }),
    layerId: uuid('layer_id').references(() => layers.id, { onDelete: 'set null' }),
    // 'pending' | 'processing' | 'done' | 'failed'
    status: text('status').notNull().default('pending'),
    fileName: text('file_name').notNull(),
    fileSize: integer('file_size').notNull().default(0),
    errorMessage: text('error_message'),
    progress: integer('progress').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('import_jobs_map_id_idx').on(t.mapId),
    index('import_jobs_status_idx').on(t.status),
  ]
);

// Type exports for use in queries
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type MapRow = typeof maps.$inferSelect;
export type NewMap = typeof maps.$inferInsert;
export type LayerRow = typeof layers.$inferSelect;
export type NewLayer = typeof layers.$inferInsert;
export type FeatureRow = typeof features.$inferSelect;
export type NewFeature = typeof features.$inferInsert;
export type ShareRow = typeof shares.$inferSelect;
export type NewShare = typeof shares.$inferInsert;
export type ImportJobRow = typeof importJobs.$inferSelect;
export type NewImportJob = typeof importJobs.$inferInsert;
export type MapEventRow = typeof mapEvents.$inferSelect;
export type NewMapEvent = typeof mapEvents.$inferInsert;
export type CommentRow = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;
export type MapCollaboratorRow = typeof mapCollaborators.$inferSelect;
export type NewMapCollaborator = typeof mapCollaborators.$inferInsert;
export type AnnotationRow = typeof annotations.$inferSelect;
export type NewAnnotation = typeof annotations.$inferInsert;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type AnnotationObjectRow = typeof annotationObjects.$inferSelect;
export type NewAnnotationObject = typeof annotationObjects.$inferInsert;
export type AnnotationChangelogRow = typeof annotationChangelog.$inferSelect;
