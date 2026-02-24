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

/** Compute a bbox [minLng, minLat, maxLng, maxLat] from a list of features */
export function computeBbox(
  features: GeoJSONFeature[]
): [number, number, number, number] | null {
  if (features.length === 0) return null;

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  function processCoords(coords: unknown): void {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      const lng = coords[0] as number;
      const lat = coords[1] as number;
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    } else {
      for (const c of coords as unknown[]) processCoords(c);
    }
  }

  for (const f of features) {
    processCoords(f.geometry.coordinates);
  }

  if (!isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}
