import type { LayerType } from '@felt-like-it/shared-types';

const LAT_HEADERS = new Set([
  'lat',
  'latitude',
  'y',
  'lat_deg',
  'lati',
  'y_coord',
  'y_coordinate',
  'ylat',
  'latitud',
]);

const LNG_HEADERS = new Set([
  'lng',
  'lon',
  'long',
  'longitude',
  'x',
  'lng_deg',
  'long_deg',
  'x_coord',
  'x_coordinate',
  'xlong',
  'longitud',
]);

/** Detect which CSV columns contain latitude and longitude values */
export function detectCoordinateColumns(
  headers: string[]
): { latCol: string; lngCol: string } | null {
  const normalized = headers.map((h) => h.toLowerCase().trim());

  let latCol: string | null = null;
  let lngCol: string | null = null;

  for (let i = 0; i < normalized.length; i++) {
    const h = normalized[i];
    const original = headers[i];
    if (h === undefined || original === undefined) continue;

    if (LAT_HEADERS.has(h) && latCol === null) {
      latCol = original;
    } else if (LNG_HEADERS.has(h) && lngCol === null) {
      lngCol = original;
    }
  }

  if (latCol !== null && lngCol !== null) {
    return { latCol, lngCol };
  }

  return null;
}

/** Check if a value is a valid WGS84 latitude (-90 to 90) */
export function isValidLatitude(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const num = Number(value);
  return !isNaN(num) && num >= -90 && num <= 90;
}

/** Check if a value is a valid WGS84 longitude (-180 to 180) */
export function isValidLongitude(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  const num = Number(value);
  return !isNaN(num) && num >= -180 && num <= 180;
}

/** Detect geometry type from a GeoJSON geometry */
export function detectGeometryType(
  geometryType: string
): 'point' | 'line' | 'polygon' | 'mixed' {
  switch (geometryType) {
    case 'Point':
    case 'MultiPoint':
      return 'point';
    case 'LineString':
    case 'MultiLineString':
      return 'line';
    case 'Polygon':
    case 'MultiPolygon':
      return 'polygon';
    default:
      return 'mixed';
  }
}

/** Detect dominant layer type from an array of GeoJSON features */
export function detectLayerType(features: Array<{ geometry: { type: string } }>): LayerType {
  if (features.length === 0) return 'mixed';

  const counts: Record<string, number> = { point: 0, line: 0, polygon: 0 };

  for (const f of features) {
    const t = detectGeometryType(f.geometry.type);
    if (t !== 'mixed' && t in counts) {
      counts[t] = (counts[t] ?? 0) + 1;
    }
  }

  const total = features.length;
  const pointRatio = (counts['point'] ?? 0) / total;
  const lineRatio = (counts['line'] ?? 0) / total;
  const polygonRatio = (counts['polygon'] ?? 0) / total;

  if (pointRatio >= 0.8) return 'point';
  if (lineRatio >= 0.8) return 'line';
  if (polygonRatio >= 0.8) return 'polygon';
  return 'mixed';
}

/**
 * Column headers that indicate a full (or near-full) geocodable address string.
 * Single-fragment headers like "city" or "zip" are intentionally excluded —
 * they rarely produce useful geocoding results on their own.
 */
const ADDRESS_HEADERS = new Set([
  'address',
  'addr',
  'full_address',
  'fulladdress',
  'full_addr',
  'address_full',
  'location',
  'loc',
  'place',
  'place_name',
  'placename',
  'street_address',
  'streetaddress',
]);

/**
 * Detect which CSV column contains geocodable address strings.
 * Returns the original (un-normalised) header name, or null if none found.
 * Priority: first matching column in definition order.
 */
export function detectAddressColumn(headers: string[]): string | null {
  for (const h of headers) {
    if (!h) continue;
    if (ADDRESS_HEADERS.has(h.toLowerCase().trim())) return h;
  }
  return null;
}

/** Detect if a column is categorical (string values, ≤ 12 unique values) */
export function isCategoricalColumn(
  values: unknown[],
  maxCategories = 12
): boolean {
  const sample = values.slice(0, 500).filter((v) => v !== null && v !== undefined && v !== '');
  if (sample.length === 0) return false;

  // If all numeric, not categorical
  const allNumeric = sample.every((v) => !isNaN(Number(v)));
  if (allNumeric) return false;

  const unique = new Set(sample.map(String));
  return unique.size >= 2 && unique.size <= maxCategories;
}

/** Detect if a column is numeric */
export function isNumericColumn(values: unknown[]): boolean {
  const sample = values.slice(0, 500).filter((v) => v !== null && v !== undefined && v !== '');
  if (sample.length === 0) return false;
  return sample.every((v) => !isNaN(Number(v)));
}

/** Get unique values from a column (up to a limit) */
export function getUniqueValues(values: unknown[], limit = 50): string[] {
  const unique = new Set<string>();
  for (const v of values) {
    if (v !== null && v !== undefined && v !== '') {
      unique.add(String(v));
    }
    if (unique.size >= limit) break;
  }
  return Array.from(unique);
}
