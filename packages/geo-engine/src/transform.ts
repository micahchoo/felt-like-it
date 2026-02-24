/** Coordinate transform utilities — normalize to WGS84 (EPSG:4326) */

export interface CoordinatePair {
  lng: number;
  lat: number;
}

/**
 * Normalize coordinates to WGS84 range.
 * Handles common issues like coordinates slightly outside range due to float precision.
 */
export function normalizeCoordinates(lng: number, lat: number): CoordinatePair | null {
  // Clamp minor float precision issues
  const clampedLng = Math.max(-180, Math.min(180, lng));
  const clampedLat = Math.max(-90, Math.min(90, lat));

  // If original was way out of range, reject
  if (Math.abs(lng) > 180.001 || Math.abs(lat) > 90.001) {
    return null;
  }

  return { lng: clampedLng, lat: clampedLat };
}

/**
 * Detect if coordinates appear to be in a projected CRS (large values) vs WGS84.
 * Returns true if likely WGS84, false if likely projected (e.g., UTM, Mercator).
 */
export function looksLikeWGS84(values: Array<[number, number]>): boolean {
  if (values.length === 0) return true;

  return values.every(([x, y]) => {
    return Math.abs(x) <= 180 && Math.abs(y) <= 90;
  });
}

/**
 * Convert a lat/lng pair from degrees to radians.
 */
export function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Convert a value from radians to degrees.
 */
export function toDegrees(radians: number): number {
  return (radians * 180) / Math.PI;
}

/**
 * Compute the bounding box of a GeoJSON FeatureCollection.
 * Returns [minLng, minLat, maxLng, maxLat].
 */
export function computeBbox(features: Array<{ geometry: { type: string; coordinates: unknown } }>): [number, number, number, number] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  function processCoords(coords: unknown): void {
    if (!Array.isArray(coords)) return;

    if (coords.length >= 2 && typeof coords[0] === 'number') {
      const lng = coords[0] as number;
      const lat = coords[1] as number;
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    } else {
      for (const c of coords as unknown[]) {
        processCoords(c);
      }
    }
  }

  for (const f of features) {
    processCoords(f.geometry.coordinates);
  }

  if (!isFinite(minLng)) return null;
  return [minLng, minLat, maxLng, maxLat];
}
