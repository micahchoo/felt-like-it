/**
 * Measurement utilities for geographic features.
 *
 * All computations use WGS84 geodesic algorithms via Turf.js:
 * - `measureLine`    → total path distance
 * - `measurePolygon` → area + perimeter
 * - `formatDistance` / `formatArea` → locale-aware human-readable strings
 *
 * Units are expressed as string literals; `DISTANCE_UNITS` and `AREA_UNITS`
 * arrays are the canonical ordered lists for unit-selector dropdowns.
 */

import { length as turfLength, area as turfArea, convertLength, convertArea, lineString as turfLineString, polygon as turfPolygon } from '@turf/turf';

// ── Unit types ───────────────────────────────────────────────────────────────

export type DistanceUnit = 'km' | 'mi' | 'm' | 'ft';
export type AreaUnit = 'km2' | 'mi2' | 'ha' | 'ac' | 'm2';

/** Ordered list for distance unit selector. */
export const DISTANCE_UNITS: ReadonlyArray<{ readonly value: DistanceUnit; readonly label: string }> = [
  { value: 'km', label: 'km' },
  { value: 'mi', label: 'mi' },
  { value: 'm',  label: 'm' },
  { value: 'ft', label: 'ft' },
] as const;

/** Ordered list for area unit selector. */
export const AREA_UNITS: ReadonlyArray<{ readonly value: AreaUnit; readonly label: string }> = [
  { value: 'km2', label: 'km²' },
  { value: 'mi2', label: 'mi²' },
  { value: 'ha',  label: 'ha' },
  { value: 'ac',  label: 'ac' },
  { value: 'm2',  label: 'm²' },
] as const;

// ── Result types ─────────────────────────────────────────────────────────────

export interface DistanceMeasurement {
  readonly type: 'distance';
  /** Geodesic path length in kilometres. */
  readonly distanceKm: number;
  /** Number of vertices (including start/end). */
  readonly vertexCount: number;
}

export interface AreaMeasurement {
  readonly type: 'area';
  /** Area in square metres (WGS84 spherical). */
  readonly areaM2: number;
  /** Perimeter (outer ring) in kilometres. */
  readonly perimeterKm: number;
  /** Number of vertices in the outer ring (excluding the closing duplicate). */
  readonly vertexCount: number;
}

export type MeasurementResult = DistanceMeasurement | AreaMeasurement;

// ── Compute ──────────────────────────────────────────────────────────────────

/**
 * Compute geodesic distance along a line string.
 * @param coordinates WGS84 [lng, lat] pairs — must have at least 2 points.
 */
export function measureLine(coordinates: [number, number][]): DistanceMeasurement {
  if (coordinates.length < 2) {
    return { type: 'distance', distanceKm: 0, vertexCount: coordinates.length };
  }
  const line = turfLineString(coordinates);
  const distanceKm = turfLength(line, { units: 'kilometers' });
  return { type: 'distance', distanceKm, vertexCount: coordinates.length };
}

/**
 * Compute area and perimeter of a polygon.
 * @param coordinates Polygon rings: `[outerRing, ...holes]` where each ring is
 *   an array of WGS84 [lng, lat] pairs.  The outer ring must close (first === last).
 */
export function measurePolygon(coordinates: [number, number][][]): AreaMeasurement {
  const outerRing = coordinates[0] ?? [];
  if (outerRing.length < 4) {
    // Degenerate — not a valid polygon
    return { type: 'area', areaM2: 0, perimeterKm: 0, vertexCount: Math.max(0, outerRing.length - 1) };
  }

  const poly = turfPolygon(coordinates);
  const areaM2 = turfArea(poly);

  // Perimeter = geodesic length of the outer ring
  const ring = turfLineString(outerRing);
  const perimeterKm = turfLength(ring, { units: 'kilometers' });

  // Vertex count: exclude the closing duplicate that GeoJSON outer rings carry
  const vertexCount = outerRing.length - 1;

  return { type: 'area', areaM2, perimeterKm, vertexCount };
}

// ── Format ───────────────────────────────────────────────────────────────────

/**
 * Format a distance measurement in the requested unit with adaptive precision.
 * @param km   Value in kilometres.
 * @param unit Target display unit.
 */
export function formatDistance(km: number, unit: DistanceUnit): string {
  let value: number;
  switch (unit) {
    case 'km': value = km; break;
    case 'mi': value = convertLength(km, 'kilometers', 'miles'); break;
    case 'm':  value = km * 1000; break;
    case 'ft': value = convertLength(km, 'kilometers', 'feet'); break;
  }
  return `${adaptiveFormat(value)} ${unit}`;
}

/**
 * Format an area measurement in the requested unit with adaptive precision.
 * @param m2   Value in square metres.
 * @param unit Target display unit.
 */
export function formatArea(m2: number, unit: AreaUnit): string {
  let value: number;
  switch (unit) {
    case 'm2':  value = m2; break;
    case 'km2': value = m2 / 1_000_000; break;
    case 'ha':  value = m2 / 10_000; break;
    case 'mi2': value = convertArea(m2, 'meters', 'miles'); break;
    case 'ac':  value = convertArea(m2, 'meters', 'acres'); break;
  }
  return `${adaptiveFormat(value)} ${unit}`;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/** Locale-aware number format with magnitude-adaptive decimal places. */
function adaptiveFormat(n: number): string {
  const abs = Math.abs(n);
  let fractionDigits: number;
  if (abs >= 10_000)       fractionDigits = 0;
  else if (abs >= 100)     fractionDigits = 1;
  else if (abs >= 1)       fractionDigits = 3;
  else if (abs >= 0.001)   fractionDigits = 5;
  else                     fractionDigits = 8;

  return n.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}
