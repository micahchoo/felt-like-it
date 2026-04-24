import type { AnnotationObject, GeoJSONFeature } from '@felt-like-it/shared-types';

/**
 * Phase 3 Wave D-α: project an AnnotationObject into the GeoJSONFeature shape
 * DataTable expects. Used by the per-layer "annotations" view (DataTable's
 * primary data source for small layers post-Phase-3).
 *
 * Geometry sourcing:
 *  - point | path | region | measurement → anchor.geometry directly
 *  - feature | viewport → degenerate Point at [0,0]; DataTable's row click +
 *    bbox zoom won't be useful for these (the anchor doesn't carry a renderable
 *    geometry), but they shouldn't appear in the per-layer list anyway because
 *    they have no layer association in the unified model.
 *
 * Properties surfaced (keys visible in DataTable columns):
 *  - name, description — first-class user labels (Phase 1 Wave 1)
 *  - anchor_type — discriminator for column sort/filter
 *  - body — when the content is single-text, the body text; else empty
 *
 * Note: keys starting with `_` are hidden from DataTable's column derivation.
 * The `_id` key carries the annotation row id back to row-click handlers.
 */
export function annotationToFeatureRow(a: AnnotationObject): GeoJSONFeature {
  const geom =
    a.anchor.type === 'point' ||
    a.anchor.type === 'path' ||
    a.anchor.type === 'region' ||
    a.anchor.type === 'measurement'
      ? a.anchor.geometry
      : ({ type: 'Point', coordinates: [0, 0] } as const);

  const bodyText =
    a.content.kind === 'single' && a.content.body.type === 'text'
      ? a.content.body.text
      : '';

  const properties: Record<string, unknown> = {
    name: a.name ?? '',
    description: a.description ?? '',
    anchor_type: a.anchor.type,
    body: bodyText,
    _id: a.id,
  };

  return {
    type: 'Feature',
    id: a.id,
    geometry: geom,
    properties,
  } as GeoJSONFeature;
}

/**
 * Filter the full map-scoped annotations list down to one layer's rows
 * and project each into DataTable's row shape.
 *
 * Handles the empty-annotations and unmatched-layer cases — both produce
 * an empty array, which DataTable renders as its empty state.
 */
export function annotationsToLayerFeatureRows(
  annotations: readonly AnnotationObject[],
  layerId: string
): GeoJSONFeature[] {
  const matched = annotations.filter((a) => a.layerId === layerId);
  return matched.map(annotationToFeatureRow);
}
