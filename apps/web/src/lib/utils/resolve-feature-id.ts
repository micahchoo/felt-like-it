import { toFeatureUUID, type FeatureUUID } from '@felt-like-it/shared-types';

/**
 * Resolve database UUID from a MapLibre feature.
 * GeoJSON sources set `properties._id`; Martin vector tiles expose `id` as a property.
 * Falls back to `feat.id` (works for GeoJSON sources where id is set directly).
 * Returns null if no valid UUID can be resolved.
 */
export function resolveFeatureId(
  feat: { id?: string | number; properties?: Record<string, unknown> | null }
): FeatureUUID | null {
  const props = feat.properties;
  return (
    toFeatureUUID(props?.['_id'] as string) ??
    toFeatureUUID(props?.['id'] as string) ??
    toFeatureUUID(feat.id as string)
  );
}
