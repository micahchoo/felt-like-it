import { z } from 'zod';

// ─── Per-operation schemas — each is narrow; illegal param combos are unrepresentable ─

const layerIdField = z.string().uuid();

export const GeoBufferOpSchema = z.object({
  type: z.literal('buffer'),
  layerId: layerIdField,
  /** Buffer radius in kilometres. Must be positive. Max 1000 km. */
  distanceKm: z.number().positive().max(1000),
});

export const GeoConvexHullOpSchema = z.object({
  type: z.literal('convex_hull'),
  layerId: layerIdField,
});

export const GeoCentroidOpSchema = z.object({
  type: z.literal('centroid'),
  layerId: layerIdField,
});

export const GeoDissolveOpSchema = z.object({
  type: z.literal('dissolve'),
  layerId: layerIdField,
  /** Property key to dissolve by. Omit to dissolve all features into one. */
  field: z.string().min(1).max(255).optional(),
});

export const GeoIntersectOpSchema = z.object({
  type: z.literal('intersect'),
  layerIdA: layerIdField,
  layerIdB: layerIdField,
});

export const GeoUnionOpSchema = z.object({
  type: z.literal('union'),
  layerId: layerIdField,
});

export const GeoClipOpSchema = z.object({
  type: z.literal('clip'),
  /** Features to clip. */
  layerIdA: layerIdField,
  /** Clip mask — only the extent of this layer is used. */
  layerIdB: layerIdField,
});

/** Discriminated union — adding a new op requires a handler or TypeScript errors. */
export const GeoprocessingOpSchema = z.discriminatedUnion('type', [
  GeoBufferOpSchema,
  GeoConvexHullOpSchema,
  GeoCentroidOpSchema,
  GeoDissolveOpSchema,
  GeoIntersectOpSchema,
  GeoUnionOpSchema,
  GeoClipOpSchema,
]);

// ─── Inferred TypeScript types ────────────────────────────────────────────────

export type GeoBufferOp     = z.infer<typeof GeoBufferOpSchema>;
export type GeoConvexHullOp = z.infer<typeof GeoConvexHullOpSchema>;
export type GeoCentroidOp   = z.infer<typeof GeoCentroidOpSchema>;
export type GeoDissolveOp   = z.infer<typeof GeoDissolveOpSchema>;
export type GeoIntersectOp  = z.infer<typeof GeoIntersectOpSchema>;
export type GeoUnionOp      = z.infer<typeof GeoUnionOpSchema>;
export type GeoClipOp       = z.infer<typeof GeoClipOpSchema>;
export type GeoprocessingOp = z.infer<typeof GeoprocessingOpSchema>;

/** Human-readable labels used in UI — keep in sync with GeoprocessingOp['type']. */
export const GEO_OP_LABELS: Record<GeoprocessingOp['type'], string> = {
  buffer:      'Buffer',
  convex_hull: 'Convex Hull',
  centroid:    'Centroids',
  dissolve:    'Dissolve',
  intersect:   'Intersect',
  union:       'Union',
  clip:        'Clip',
};
