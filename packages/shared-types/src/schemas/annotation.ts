/**
 * Annotation schemas — geographic pins with typed media content.
 *
 * An annotation is a map-anchored note that can carry one of six content types:
 *   text  — plain text note (up to 5 000 chars)
 *   emoji — a single emoji character with an optional label
 *   gif   — an animated GIF URL (e.g. Tenor / Giphy CDN)
 *   image — a static image URL with an optional caption
 *   link  — a URL with optional title and description (link card)
 *   iiif  — a IIIF Presentation API manifest URL; the NavPlace extension
 *           (https://iiif.io/api/extension/navplace/) provides a GeoJSON
 *           FeatureCollection with the resource's geographic footprint
 *
 * The `content` field is a strict Zod discriminated union on `type` — illegal
 * states (e.g. a text annotation with a `manifestUrl` field) are unrepresentable
 * at the schema level.
 *
 * The geographic anchor is always a WGS84 GeoJSON Point [lng, lat].
 * Coordinate bounds are validated by the schema before any DB write.
 */

import { z } from 'zod';
import { GeoJSONFeatureCollectionSchema } from './feature.js';

// ─── Content variants ─────────────────────────────────────────────────────────

const TextContentSchema = z.object({
  type: z.literal('text'),
  /** Annotation body. Markdown is not interpreted — plain text only. */
  text: z.string().min(1).max(5000),
});

const EmojiContentSchema = z.object({
  type: z.literal('emoji'),
  /**
   * A single emoji or short ZWJ sequence (e.g. "🌊", "🏔️", "🇺🇸").
   * Capped at 10 characters — complex ZWJ sequences still fit comfortably.
   */
  emoji: z.string().min(1).max(10),
  /** Short label displayed beneath the emoji pin on the map. */
  label: z.string().max(200).optional(),
});

const GifContentSchema = z.object({
  type: z.literal('gif'),
  /** Publicly accessible animated GIF URL (e.g. Tenor or Giphy CDN link). */
  url: z.string().url(),
  /** Accessible description for screen readers and broken-image fallback. */
  altText: z.string().max(500).optional(),
});

const ImageContentSchema = z.object({
  type: z.literal('image'),
  /** Publicly accessible static image URL (JPEG / PNG / WebP / SVG). */
  url: z.string().url(),
  /** Optional caption rendered below the image. */
  caption: z.string().max(500).optional(),
});

const LinkContentSchema = z.object({
  type: z.literal('link'),
  /** Target URL for the link card. */
  url: z.string().url(),
  /** Short title for the link card header. */
  title: z.string().max(200).optional(),
  /** One-line description or excerpt shown below the title. */
  description: z.string().max(500).optional(),
});

const IiifContentSchema = z.object({
  type: z.literal('iiif'),
  /**
   * URL of a IIIF Presentation API v2 or v3 manifest.
   *
   * The server-side `annotations.fetchIiifNavPlace` procedure can populate
   * `navPlace` by fetching this URL and extracting the NavPlace extension
   * (https://iiif.io/api/extension/navplace/).
   */
  manifestUrl: z.string().url(),
  /** Human-readable label for the manifest resource (e.g. the `label` field). */
  label: z.string().max(200).optional(),
  /**
   * IIIF NavPlace GeoJSON FeatureCollection.
   *
   * Absent when: (a) the manifest has no `navPlace` extension, or (b) the
   * manifest has not yet been fetched via `annotations.fetchIiifNavPlace`.
   * Populated lazily — the client calls `fetchIiifNavPlace` after creation
   * and then calls `annotations.update` to persist the resolved navPlace.
   */
  navPlace: GeoJSONFeatureCollectionSchema.optional(),
});

const MeasurementContentSchema = z.object({
  type: z.literal('measurement'),
  /** Whether this measures distance or area. */
  measurementType: z.enum(['distance', 'area']),
  /** Raw value in meters (distance) or square meters (area). */
  value: z.number(),
  /** Display unit used at save time (e.g. 'km', 'ha', 'mi'). */
  unit: z.string().min(1).max(20),
  /** Formatted string for display (e.g. '1.24 km'). */
  displayValue: z.string().min(1).max(100),
  /** Optional user-provided note about this measurement. */
  label: z.string().max(500).optional(),
});

// ─── Discriminated union ──────────────────────────────────────────────────────

/**
 * Annotation content — exhaustive discriminated union keyed on `type`.
 *
 * Every variant carries only the fields relevant to its type.
 * The TypeScript type system (and Zod at runtime) enforce this contract —
 * a gif annotation cannot carry a `text` field, etc.
 */
export const AnnotationContentSchema = z.discriminatedUnion('type', [
  TextContentSchema,
  EmojiContentSchema,
  GifContentSchema,
  ImageContentSchema,
  LinkContentSchema,
  IiifContentSchema,
  MeasurementContentSchema,
]);

export type AnnotationContent = z.infer<typeof AnnotationContentSchema>;

// ─── Geographic anchor ────────────────────────────────────────────────────────

/**
 * WGS84 Point anchor for an annotation.
 *
 * Follows the GeoJSON coordinate order: [longitude, latitude].
 * Bounds (-180..180 for lng, -90..90 for lat) are validated at the schema
 * level so invalid coordinates never reach the database.
 */
export const AnnotationAnchorSchema = z.object({
  type: z.literal('Point'),
  coordinates: z.tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ]),
});

export type AnnotationAnchor = z.infer<typeof AnnotationAnchorSchema>;

// ─── Full annotation record ───────────────────────────────────────────────────

/**
 * A full annotation record as returned by the tRPC `annotations.list` and
 * `annotations.create` / `annotations.update` procedures.
 */
export const AnnotationSchema = z.object({
  id: z.string().uuid(),
  mapId: z.string().uuid(),
  /**
   * Null when the author's account has been deleted.
   * Mirrors the `comments.userId` nullable FK pattern.
   */
  userId: z.string().uuid().nullable(),
  /**
   * Author name denormalized at insert time (mirrors `comments.authorName`).
   * Survives user deletion; no JOIN is required when listing annotations.
   */
  authorName: z.string().min(1).max(200),
  /** Geographic pin location. Always a WGS84 Point. */
  anchor: AnnotationAnchorSchema,
  /** Typed media content — see AnnotationContentSchema variants above. */
  content: AnnotationContentSchema,
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Annotation = z.infer<typeof AnnotationSchema>;

// ─── Input schemas for tRPC procedures ───────────────────────────────────────

/** tRPC input: create a new annotation on the map. */
export const CreateAnnotationSchema = z.object({
  mapId: z.string().uuid(),
  /** Geographic anchor — validated at schema level before any DB write. */
  anchor: AnnotationAnchorSchema,
  /** Typed content — must conform to one of the six content variants. */
  content: AnnotationContentSchema,
});

/**
 * tRPC input: update the content of an existing annotation.
 *
 * Note: the geographic anchor is immutable after creation (move = delete + create).
 */
export const UpdateAnnotationSchema = z.object({
  id: z.string().uuid(),
  /** Replacement content — same discriminated union rules apply. */
  content: AnnotationContentSchema,
});
