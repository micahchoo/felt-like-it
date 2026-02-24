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

/**
 * Spatial join: copy polygon attributes onto each point that falls within it.
 * Points not contained by any polygon are still emitted (with only point attributes).
 */
export const GeoPointInPolygonOpSchema = z.object({
  type: z.literal('point_in_polygon'),
  /** Point layer — features are emitted into the output. */
  layerIdPoints: layerIdField,
  /** Polygon layer — attributes are merged into each matching point. */
  layerIdPolygons: layerIdField,
});

/**
 * Spatial join: for each feature in layer A, find the nearest feature in layer B
 * and merge its attributes in. Uses PostGIS `<->` KNN operator (bounding-box index).
 */
export const GeoNearestNeighborOpSchema = z.object({
  type: z.literal('nearest_neighbor'),
  /** Source layer — features drive the output geometry. */
  layerIdA: layerIdField,
  /** Neighbor layer — the closest feature's attributes are merged in. */
  layerIdB: layerIdField,
});

/**
 * Aggregate point layer statistics per polygon.
 *
 * `aggregation`:
 *   - `count` — number of points within each polygon (field ignored)
 *   - `sum`   — sum of a numeric point attribute (field required)
 *   - `avg`   — mean of a numeric point attribute (field required)
 *
 * `outputField` names the new property written on each output polygon.
 * Defaults to 'count', 'sum', or 'avg' if omitted.
 *
 * NOTE: `z.discriminatedUnion` cannot accept `.refine()`-wrapped schemas as members
 * (ZodEffects has no `.shape` accessor). The base schema is used in the union; the
 * `field`-required invariant for sum/avg is enforced at the router level.
 */
const GeoAggregateBaseSchema = z.object({
  type: z.literal('aggregate'),
  /** Polygon layer — one output feature per polygon. */
  layerIdPolygons: layerIdField,
  /** Point layer — points are counted/summed/averaged within each polygon. */
  layerIdPoints: layerIdField,
  /** Aggregation function to apply. */
  aggregation: z.enum(['count', 'sum', 'avg']),
  /** Numeric property in point layer to aggregate. Required for sum and avg. */
  field: z.string().min(1).max(255).optional(),
  /** Name of the output attribute on each polygon. Defaults to aggregation type. */
  outputField: z.string().min(1).max(255).optional(),
});

/** Refined export — validates that `field` is set for sum/avg. Use this when parsing
 *  an aggregate op in isolation (e.g., in tests or direct API call validation). */
export const GeoAggregateOpSchema = GeoAggregateBaseSchema.refine(
  (data) =>
    data.aggregation === 'count' ||
    (data.field !== undefined && data.field.length > 0),
  { message: 'field is required for sum and avg aggregations', path: ['field'] }
);

/** Discriminated union — adding a new op requires a handler or TypeScript errors. */
export const GeoprocessingOpSchema = z.discriminatedUnion('type', [
  GeoBufferOpSchema,
  GeoConvexHullOpSchema,
  GeoCentroidOpSchema,
  GeoDissolveOpSchema,
  GeoIntersectOpSchema,
  GeoUnionOpSchema,
  GeoClipOpSchema,
  GeoPointInPolygonOpSchema,
  GeoNearestNeighborOpSchema,
  GeoAggregateBaseSchema,  // base schema; router enforces field invariant for sum/avg
]);

// ─── Inferred TypeScript types ────────────────────────────────────────────────

export type GeoBufferOp          = z.infer<typeof GeoBufferOpSchema>;
export type GeoConvexHullOp      = z.infer<typeof GeoConvexHullOpSchema>;
export type GeoCentroidOp        = z.infer<typeof GeoCentroidOpSchema>;
export type GeoDissolveOp        = z.infer<typeof GeoDissolveOpSchema>;
export type GeoIntersectOp       = z.infer<typeof GeoIntersectOpSchema>;
export type GeoUnionOp           = z.infer<typeof GeoUnionOpSchema>;
export type GeoClipOp            = z.infer<typeof GeoClipOpSchema>;
export type GeoPointInPolygonOp  = z.infer<typeof GeoPointInPolygonOpSchema>;
export type GeoNearestNeighborOp = z.infer<typeof GeoNearestNeighborOpSchema>;
export type GeoAggregateOp       = z.infer<typeof GeoAggregateOpSchema>;
export type GeoprocessingOp      = z.infer<typeof GeoprocessingOpSchema>;

/** Human-readable labels used in UI — keep in sync with GeoprocessingOp['type']. */
export const GEO_OP_LABELS: Record<GeoprocessingOp['type'], string> = {
  buffer:            'Buffer',
  convex_hull:       'Convex Hull',
  centroid:          'Centroids',
  dissolve:          'Dissolve',
  intersect:         'Intersect',
  union:             'Union',
  clip:              'Clip',
  point_in_polygon:  'Point in Polygon Join',
  nearest_neighbor:  'Nearest Neighbor Join',
  aggregate:         'Aggregate (Points → Polygons)',
};
