/**
 * Annotation Object schemas — Penpot-inspired flat object store.
 *
 * Replaces the original single-content annotation schema with:
 *   - Four anchor types: point, region, feature, viewport
 *   - Single or slotted content (kind discriminator)
 *   - Threading via parentId
 *   - Version for optimistic concurrency
 */

import { z } from 'zod';
import { AnnotationContentSchema } from './annotation.js';
import { AnnotationStyleSchema } from './annotation-style.js';

// Re-export the original content union for convenience
export { AnnotationContentSchema as AnnotationContentBodySchema };

// ─── Geometry schemas (RFC 7946) ─────────────────────────────────────────────

const CoordinateSchema = z.tuple([z.number(), z.number()]).or(
  z.tuple([z.number(), z.number(), z.number()])
);

/** GeoJSON Point with WGS84 bounds validation. Supports optional altitude (3D). */
export const PointGeometrySchema = z.object({
  type: z.literal('Point'),
  coordinates: z.union([
    z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]),
    z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90), z.number()]),
  ]),
});

const LinearRingSchema = z.array(CoordinateSchema).min(4);

/** GeoJSON Polygon. */
export const PolygonGeometrySchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(LinearRingSchema).min(1),
});

/** GeoJSON LineString for measurement geometries. */
export const LineStringGeometrySchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(CoordinateSchema).min(2),
});

/** Bounding box: [sw_lng, sw_lat, ne_lng, ne_lat]. */
const BoundsSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);

// ─── Anchor schema ───────────────────────────────────────────────────────────

export const AnchorSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('point'),
    geometry: PointGeometrySchema,
  }),
  z.object({
    type: z.literal('region'),
    geometry: PolygonGeometrySchema,
  }),
  z.object({
    type: z.literal('feature'),
    featureId: z.string().uuid(),
    layerId: z.string().uuid(),
    featureDeleted: z.boolean().optional(),
  }),
  z.object({
    type: z.literal('viewport'),
    bounds: BoundsSchema.optional(),
  }),
  z.object({
    type: z.literal('measurement'),
    geometry: z.union([PointGeometrySchema, PolygonGeometrySchema, LineStringGeometrySchema]),
  }),
  // `path` — a line geometry first-class on an annotation, semantically distinct
  // from `measurement` (which was implicitly measurement-labelled). Added per
  // unified-annotations.md rule 1: line features convert to `path` anchors.
  z.object({
    type: z.literal('path'),
    geometry: LineStringGeometrySchema,
  }),
]);

export type Anchor = z.infer<typeof AnchorSchema>;

// ─── Content schema (single or slotted) ──────────────────────────────────────

const SingleContentSchema = z.object({
  kind: z.literal('single'),
  body: AnnotationContentSchema,
});

const SlottedContentSchema = z.object({
  kind: z.literal('slotted'),
  slots: z.record(z.string(), AnnotationContentSchema.nullable()),
});

export const AnnotationObjectContentSchema = z.discriminatedUnion('kind', [
  SingleContentSchema,
  SlottedContentSchema,
]);

export type AnnotationObjectContent = z.infer<typeof AnnotationObjectContentSchema>;

// ─── Full annotation object record ───────────────────────────────────────────

export const AnnotationObjectSchema = z.object({
  id: z.string().uuid(),
  mapId: z.string().uuid(),
  parentId: z.string().uuid().nullable(),
  authorId: z.string().uuid().nullable(),
  authorName: z.string().min(1).max(200),
  anchor: AnchorSchema,
  content: AnnotationObjectContentSchema,
  templateId: z.string().uuid().nullable(),
  /** Optional first-class label shown in list rows and transferred by convert (Felt-parity Wave 1). */
  name: z.string().min(1).max(200).nullable().optional(),
  /** Optional rich-text body beyond the structured content. Max 5000 chars. */
  description: z.string().max(5000).nullable().optional(),
  /** Assigned group/folder. NULL = ungrouped (root of the Sidebar List). */
  groupId: z.string().uuid().nullable().optional(),
  /** User-controlled visual style. Renderer falls back to defaults when NULL. */
  style: AnnotationStyleSchema.nullable().optional(),
  ordinal: z.number().int(),
  version: z.number().int(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type AnnotationObject = z.infer<typeof AnnotationObjectSchema>;

// ─── Input schemas ───────────────────────────────────────────────────────────

export const CreateAnnotationObjectSchema = z.object({
  mapId: z.string().uuid(),
  parentId: z.string().uuid().optional(),
  anchor: AnchorSchema,
  content: AnnotationObjectContentSchema,
  templateId: z.string().uuid().optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).optional(),
  groupId: z.string().uuid().optional(),
  style: AnnotationStyleSchema.optional(),
});

export const UpdateAnnotationObjectSchema = z.object({
  id: z.string().uuid(),
  content: AnnotationObjectContentSchema.optional(),
  /** Optional anchor replacement (e.g. converting orphaned feature → point). */
  anchor: AnchorSchema.optional(),
  /** Client must send current version for optimistic concurrency. */
  version: z.number().int(),
  /** Pass null to clear; omit to leave unchanged. */
  name: z.string().min(1).max(200).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  groupId: z.string().uuid().nullable().optional(),
  style: AnnotationStyleSchema.nullable().optional(),
});

export const DeleteAnnotationObjectSchema = z.object({
  id: z.string().uuid(),
  /** Current version observed by the client — enforces If-Match at the service layer. */
  version: z.number().int(),
});
