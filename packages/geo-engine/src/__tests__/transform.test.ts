import { describe, it, expect } from 'vitest';
import { normalizeCoordinates, looksLikeWGS84, toRadians, toDegrees, computeBbox } from '../transform.js';

describe('normalizeCoordinates', () => {
  it('returns valid coordinates unchanged', () => {
    expect(normalizeCoordinates(-122.4, 37.8)).toEqual({ lng: -122.4, lat: 37.8 });
  });

  it('clamps minor float precision overflow', () => {
    const result = normalizeCoordinates(180.0001, 90.0001);
    expect(result).toEqual({ lng: 180, lat: 90 });
  });

  it('clamps negative overflow', () => {
    const result = normalizeCoordinates(-180.0001, -90.0001);
    expect(result).toEqual({ lng: -180, lat: -90 });
  });

  it('rejects coordinates way outside WGS84 range', () => {
    expect(normalizeCoordinates(500000, 37.8)).toBeNull();
    expect(normalizeCoordinates(-122.4, 200)).toBeNull();
  });

  it('rejects at the exact threshold boundary (>180.001)', () => {
    expect(normalizeCoordinates(180.002, 0)).toBeNull();
    expect(normalizeCoordinates(0, 90.002)).toBeNull();
  });

  it('accepts at the exact threshold boundary (<=180.001)', () => {
    const result = normalizeCoordinates(180.001, 90.001);
    expect(result).toEqual({ lng: 180, lat: 90 });
  });

  it('handles zero coordinates', () => {
    expect(normalizeCoordinates(0, 0)).toEqual({ lng: 0, lat: 0 });
  });
});

describe('looksLikeWGS84', () => {
  it('returns true for WGS84 coordinates', () => {
    expect(looksLikeWGS84([[-122.4, 37.8], [2.3, 48.9]])).toBe(true);
  });

  it('returns false for projected coordinates (UTM-scale values)', () => {
    expect(looksLikeWGS84([[500000, 4649776]])).toBe(false);
  });

  it('returns true for empty array', () => {
    expect(looksLikeWGS84([])).toBe(true);
  });

  it('returns true for boundary values (180, 90)', () => {
    expect(looksLikeWGS84([[180, 90], [-180, -90]])).toBe(true);
  });

  it('returns false if any coordinate exceeds range', () => {
    expect(looksLikeWGS84([[0, 0], [181, 0]])).toBe(false);
  });
});

describe('toRadians', () => {
  it('converts 180 degrees to pi', () => {
    expect(toRadians(180)).toBeCloseTo(Math.PI);
  });

  it('converts 0 degrees to 0', () => {
    expect(toRadians(0)).toBe(0);
  });

  it('converts 90 degrees to pi/2', () => {
    expect(toRadians(90)).toBeCloseTo(Math.PI / 2);
  });
});

describe('toDegrees', () => {
  it('converts pi to 180 degrees', () => {
    expect(toDegrees(Math.PI)).toBeCloseTo(180);
  });

  it('converts 0 to 0', () => {
    expect(toDegrees(0)).toBe(0);
  });

  it('round-trips with toRadians', () => {
    expect(toDegrees(toRadians(42.5))).toBeCloseTo(42.5);
  });
});

describe('computeBbox', () => {
  it('computes bounding box for point features', () => {
    const features = [
      { geometry: { type: 'Point', coordinates: [-122.4, 37.7] } },
      { geometry: { type: 'Point', coordinates: [-122.5, 37.8] } },
    ];
    expect(computeBbox(features)).toEqual([-122.5, 37.7, -122.4, 37.8]);
  });

  it('computes bounding box for a polygon feature', () => {
    const features = [
      { geometry: { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]] } },
    ];
    expect(computeBbox(features)).toEqual([0, 0, 10, 10]);
  });

  it('computes bounding box for a linestring feature', () => {
    const features = [
      { geometry: { type: 'LineString', coordinates: [[1, 2], [3, 4], [5, 6]] } },
    ];
    expect(computeBbox(features)).toEqual([1, 2, 5, 6]);
  });

  it('returns null for empty array', () => {
    expect(computeBbox([])).toBeNull();
  });

  it('handles single-point feature (bbox is a point)', () => {
    const features = [
      { geometry: { type: 'Point', coordinates: [5, 10] } },
    ];
    expect(computeBbox(features)).toEqual([5, 10, 5, 10]);
  });

  it('spans across mixed geometry types', () => {
    const features = [
      { geometry: { type: 'Point', coordinates: [0, 0] } },
      { geometry: { type: 'LineString', coordinates: [[10, 10], [20, 20]] } },
    ];
    expect(computeBbox(features)).toEqual([0, 0, 20, 20]);
  });
});
