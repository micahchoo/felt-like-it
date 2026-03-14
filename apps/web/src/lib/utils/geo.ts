import type { GeoJSONFeature } from '@felt-like-it/shared-types';

/** Compute the centroid of a GeoJSON feature (returns [lng, lat]) */
export function getFeatureCentroid(feature: GeoJSONFeature): [number, number] | null {
  const geometry = feature.geometry;
  if (!geometry) return null;

  switch (geometry.type) {
    case 'Point':
      return [geometry.coordinates[0] as number, geometry.coordinates[1] as number];

    case 'LineString': {
      const coords = geometry.coordinates as [number, number][];
      if (coords.length === 0) return null;
      const mid = Math.floor(coords.length / 2);
      return coords[mid] ?? null;
    }

    case 'Polygon': {
      const ring = geometry.coordinates[0] as [number, number][];
      if (!ring || ring.length === 0) return null;
      const sumLng = ring.reduce((s, c) => s + (c[0] ?? 0), 0);
      const sumLat = ring.reduce((s, c) => s + (c[1] ?? 0), 0);
      return [sumLng / ring.length, sumLat / ring.length];
    }

    default:
      return null;
  }
}

