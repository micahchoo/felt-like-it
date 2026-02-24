/** GeoJSON validation utilities */

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/** Validate a GeoJSON object has the correct structure */
export function validateGeoJSON(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['Input is not an object'] };
  }

  const obj = data as Record<string, unknown>;

  if (!('type' in obj)) {
    errors.push('Missing required "type" property');
    return { valid: false, errors };
  }

  const type = obj['type'];

  if (type === 'FeatureCollection') {
    if (!Array.isArray(obj['features'])) {
      errors.push('"features" must be an array');
    } else {
      const features = obj['features'] as unknown[];
      features.forEach((f, i) => {
        const featureResult = validateFeature(f);
        if (!featureResult.valid) {
          errors.push(...featureResult.errors.map((e) => `Feature ${i}: ${e}`));
        }
      });
    }
  } else if (type === 'Feature') {
    const featureResult = validateFeature(data);
    errors.push(...featureResult.errors);
  } else {
    const geoResult = validateGeometry(data);
    errors.push(...geoResult.errors);
  }

  return { valid: errors.length === 0, errors };
}

function validateFeature(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['Feature is not an object'] };
  }

  const f = data as Record<string, unknown>;

  if (f['type'] !== 'Feature') {
    errors.push('Feature "type" must be "Feature"');
  }

  if (!('geometry' in f)) {
    errors.push('Feature missing "geometry" property');
  } else if (f['geometry'] !== null) {
    const geoResult = validateGeometry(f['geometry']);
    errors.push(...geoResult.errors.map((e) => `geometry: ${e}`));
  }

  if (!('properties' in f)) {
    errors.push('Feature missing "properties" property');
  }

  return { valid: errors.length === 0, errors };
}

function validateGeometry(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['Geometry is not an object'] };
  }

  const g = data as Record<string, unknown>;
  const validTypes = [
    'Point',
    'MultiPoint',
    'LineString',
    'MultiLineString',
    'Polygon',
    'MultiPolygon',
    'GeometryCollection',
  ];

  if (!validTypes.includes(g['type'] as string)) {
    errors.push(`Unknown geometry type: ${String(g['type'])}`);
  }

  if (g['type'] !== 'GeometryCollection' && !Array.isArray(g['coordinates'])) {
    errors.push('Geometry missing "coordinates" array');
  }

  return { valid: errors.length === 0, errors };
}

/** Check if coordinates are within valid WGS84 range */
export function hasValidWGS84Coordinates(geometry: {
  type: string;
  coordinates: unknown;
}): boolean {
  try {
    return checkCoordinates(geometry.coordinates);
  } catch {
    return false;
  }
}

function checkCoordinates(coords: unknown): boolean {
  if (!Array.isArray(coords)) return false;

  if (coords.length >= 2 && typeof coords[0] === 'number') {
    // It's a coordinate pair or triple
    const lng = coords[0] as number;
    const lat = coords[1] as number;
    return lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
  }

  // Nested array (ring, multipoint, etc.)
  return (coords as unknown[]).every((c) => checkCoordinates(c));
}
