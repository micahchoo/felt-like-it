import { describe, it, expect } from 'vitest';
import {
  detectCoordinateColumns,
  detectAddressColumn,
  isValidLatitude,
  isValidLongitude,
  detectGeometryType,
  detectLayerType,
  isCategoricalColumn,
  isNumericColumn,
  getUniqueValues,
} from '../detect.js';

describe('detectCoordinateColumns', () => {
  it('detects standard lat/lng headers', () => {
    const result = detectCoordinateColumns(['name', 'lat', 'lng']);
    expect(result).toEqual({ latCol: 'lat', lngCol: 'lng' });
  });

  it('detects latitude/longitude headers', () => {
    const result = detectCoordinateColumns(['latitude', 'longitude', 'name']);
    expect(result).toEqual({ latCol: 'latitude', lngCol: 'longitude' });
  });

  it('detects case-insensitive headers', () => {
    const result = detectCoordinateColumns(['LAT', 'LON']);
    expect(result).toEqual({ latCol: 'LAT', lngCol: 'LON' });
  });

  it('detects y/x headers', () => {
    const result = detectCoordinateColumns(['x', 'y', 'name']);
    expect(result).toEqual({ latCol: 'y', lngCol: 'x' });
  });

  it('returns null when no coordinate columns found', () => {
    const result = detectCoordinateColumns(['name', 'address', 'city']);
    expect(result).toBeNull();
  });

  it('returns null when only lat column present', () => {
    const result = detectCoordinateColumns(['lat', 'name']);
    expect(result).toBeNull();
  });
});

describe('isValidLatitude', () => {
  it('accepts valid latitudes', () => {
    expect(isValidLatitude(0)).toBe(true);
    expect(isValidLatitude(90)).toBe(true);
    expect(isValidLatitude(-90)).toBe(true);
    expect(isValidLatitude(37.7749)).toBe(true);
  });

  it('rejects out-of-range values', () => {
    expect(isValidLatitude(91)).toBe(false);
    expect(isValidLatitude(-91)).toBe(false);
  });

  it('rejects non-numeric values', () => {
    expect(isValidLatitude('not a number')).toBe(false);
    expect(isValidLatitude(null)).toBe(false);
    expect(isValidLatitude(undefined)).toBe(false);
  });
});

describe('isValidLongitude', () => {
  it('accepts valid longitudes', () => {
    expect(isValidLongitude(0)).toBe(true);
    expect(isValidLongitude(180)).toBe(true);
    expect(isValidLongitude(-180)).toBe(true);
    expect(isValidLongitude(-122.4194)).toBe(true);
  });

  it('rejects out-of-range values', () => {
    expect(isValidLongitude(181)).toBe(false);
    expect(isValidLongitude(-181)).toBe(false);
  });
});

describe('detectGeometryType', () => {
  it('maps Point and MultiPoint to point', () => {
    expect(detectGeometryType('Point')).toBe('point');
    expect(detectGeometryType('MultiPoint')).toBe('point');
  });

  it('maps LineString and MultiLineString to line', () => {
    expect(detectGeometryType('LineString')).toBe('line');
    expect(detectGeometryType('MultiLineString')).toBe('line');
  });

  it('maps Polygon and MultiPolygon to polygon', () => {
    expect(detectGeometryType('Polygon')).toBe('polygon');
    expect(detectGeometryType('MultiPolygon')).toBe('polygon');
  });

  it('maps unknown types to mixed', () => {
    expect(detectGeometryType('GeometryCollection')).toBe('mixed');
    expect(detectGeometryType('Unknown')).toBe('mixed');
  });
});

describe('detectLayerType', () => {
  it('returns mixed for empty features', () => {
    expect(detectLayerType([])).toBe('mixed');
  });

  it('returns point when all features are points', () => {
    const features = Array(5).fill({ geometry: { type: 'Point' } }) as Array<{geometry: {type: string}}>;
    expect(detectLayerType(features)).toBe('point');
  });

  it('returns polygon when 80%+ are polygons', () => {
    const features = [
      ...Array(9).fill({ geometry: { type: 'Polygon' } }),
      { geometry: { type: 'Point' } },
    ] as Array<{geometry: {type: string}}>;
    expect(detectLayerType(features)).toBe('polygon');
  });

  it('returns dominant type at exactly the 80% threshold', () => {
    // 80/100 = 0.80, exactly at the >= 0.8 threshold
    const features = [
      ...Array(80).fill({ geometry: { type: 'Polygon' } }),
      ...Array(20).fill({ geometry: { type: 'Point' } }),
    ] as Array<{geometry: {type: string}}>;
    expect(detectLayerType(features)).toBe('polygon');
  });

  it('returns mixed just below the 80% threshold', () => {
    // 79/100 = 0.79, just below the >= 0.8 threshold
    const features = [
      ...Array(79).fill({ geometry: { type: 'Polygon' } }),
      ...Array(21).fill({ geometry: { type: 'Point' } }),
    ] as Array<{geometry: {type: string}}>;
    expect(detectLayerType(features)).toBe('mixed');
  });

  it('returns mixed for mixed types', () => {
    const features = [
      { geometry: { type: 'Point' } },
      { geometry: { type: 'Polygon' } },
      { geometry: { type: 'LineString' } },
    ] as Array<{geometry: {type: string}}>;
    expect(detectLayerType(features)).toBe('mixed');
  });
});

describe('isCategoricalColumn', () => {
  it('identifies string categorical columns', () => {
    const values = ['red', 'blue', 'green', 'red', 'blue'];
    expect(isCategoricalColumn(values)).toBe(true);
  });

  it('rejects all-numeric columns', () => {
    const values = ['1', '2', '3', '4', '5'];
    expect(isCategoricalColumn(values)).toBe(false);
  });

  it('rejects columns with too many unique values', () => {
    const values = Array.from({ length: 20 }, (_, i) => `value_${i}`);
    expect(isCategoricalColumn(values)).toBe(false);
  });

  it('rejects empty columns', () => {
    expect(isCategoricalColumn([])).toBe(false);
  });
});

describe('isNumericColumn', () => {
  it('identifies numeric columns', () => {
    expect(isNumericColumn([1, 2.5, 3, '4', '5.5'])).toBe(true);
  });

  it('rejects mixed columns', () => {
    expect(isNumericColumn([1, 'text', 3])).toBe(false);
  });

  it('rejects empty columns', () => {
    expect(isNumericColumn([])).toBe(false);
  });
});

describe('getUniqueValues', () => {
  it('returns unique values', () => {
    const result = getUniqueValues(['a', 'b', 'a', 'c']);
    expect(result).toHaveLength(3);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).toContain('c');
  });

  it('filters null and empty values', () => {
    const result = getUniqueValues(['a', null, undefined, '', 'b']);
    expect(result).toHaveLength(2);
  });

  it('respects limit by returning exactly limit unique values', () => {
    const limit = 10;
    const totalUnique = 100;
    const values = Array.from({ length: totalUnique }, (_, i) => `val${i}`);
    const result = getUniqueValues(values, limit);
    // Must return exactly the limit, not fewer, not more
    expect(result).toHaveLength(limit);
    // All returned values must actually be unique
    expect(new Set(result).size).toBe(result.length);
  });

  it('returns all unique values when count is below limit', () => {
    const values = ['a', 'b', 'c', 'a', 'b'];
    const result = getUniqueValues(values, 50);
    expect(result).toHaveLength(3);
    expect(result.length).toBeLessThan(50);
  });
});

// ─── detectAddressColumn ──────────────────────────────────────────────────────

describe('detectAddressColumn', () => {
  it('detects "address" header', () => {
    expect(detectAddressColumn(['name', 'address', 'city'])).toBe('address');
  });

  it('detects "location" header', () => {
    expect(detectAddressColumn(['id', 'location'])).toBe('location');
  });

  it('detects "place_name" header', () => {
    expect(detectAddressColumn(['place_name', 'pop'])).toBe('place_name');
  });

  it('detects "full_address" header', () => {
    expect(detectAddressColumn(['full_address', 'zip'])).toBe('full_address');
  });

  it('detects "street_address" header', () => {
    expect(detectAddressColumn(['name', 'street_address'])).toBe('street_address');
  });

  it('is case-insensitive', () => {
    expect(detectAddressColumn(['Name', 'ADDRESS'])).toBe('ADDRESS');
    expect(detectAddressColumn(['LOCATION', 'pop'])).toBe('LOCATION');
  });

  it('returns the first matching column when multiple candidates exist', () => {
    // "address" comes before "location" in the headers array
    expect(detectAddressColumn(['location', 'address'])).toBe('location');
  });

  it('returns null when no address-like column is found', () => {
    expect(detectAddressColumn(['city', 'population', 'zip'])).toBeNull();
  });

  it('returns null for an empty headers array', () => {
    expect(detectAddressColumn([])).toBeNull();
  });

  it('returns null when a column that shares a word but does not match exactly', () => {
    // "addr_line1" is not in the known set
    expect(detectAddressColumn(['addr_line1', 'city'])).toBeNull();
  });
});
