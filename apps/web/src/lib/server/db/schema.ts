import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { customType } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

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
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
    // Stored as { center: [lng, lat], zoom: number, bearing: number, pitch: number }
    viewport: jsonb('viewport')
      .notNull()
      .default(sql`'{"center":[-98.35,39.5],"zoom":4,"bearing":0,"pitch":0}'::jsonb`),
    basemap: text('basemap').notNull().default('osm'),
    isArchived: boolean('is_archived').notNull().default(false),
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
    // MapLibre GL paint/layout + legend metadata
    style: jsonb('style').notNull().default(sql`'{}'::jsonb`),
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
    // Arbitrary feature properties (GeoJSON properties object)
    properties: jsonb('properties').notNull().default(sql`'{}'::jsonb`),
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
    /** Structured payload: layer name, file name, feature count, etc. */
    metadata: jsonb('metadata'),
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
    content: jsonb('content').notNull(),
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
