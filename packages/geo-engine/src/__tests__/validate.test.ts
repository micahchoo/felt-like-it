import { describe, it, expect } from 'vitest';
import { validateGeoJSON, hasValidWGS84Coordinates } from '../validate.js';

describe('validateGeoJSON', () => {
  it('validates a FeatureCollection', () => {
    const result = validateGeoJSON({
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: {},
        },
      ],
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('validates empty FeatureCollection', () => {
    const result = validateGeoJSON({ type: 'FeatureCollection', features: [] });
    expect(result.valid).toBe(true);
  });

  it('validates a single Feature', () => {
    const result = validateGeoJSON({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [10, 20] },
      properties: { name: 'test' },
    });
    expect(result.valid).toBe(true);
  });

  it('rejects null input', () => {
    const result = validateGeoJSON(null);
    expect(result.valid).toBe(false);
  });

  it('rejects object without type', () => {
    const result = validateGeoJSON({ features: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('reports missing geometry on Feature', () => {
    const result = validateGeoJSON({
      type: 'Feature',
      properties: {},
    });
    expect(result.valid).toBe(false);
  });

  it('reports invalid features in FeatureCollection', () => {
    const result = validateGeoJSON({
      type: 'FeatureCollection',
      features: [
        { type: 'NotAFeature', geometry: null, properties: {} },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validates a geometry directly', () => {
    const result = validateGeoJSON({
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 0],
        ],
      ],
    });
    expect(result.valid).toBe(true);
  });
});

describe('hasValidWGS84Coordinates', () => {
  it('accepts valid point coordinates', () => {
    expect(
      hasValidWGS84Coordinates({ type: 'Point', coordinates: [-122.4, 37.8] })
    ).toBe(true);
  });

  it('rejects out-of-range longitude', () => {
    expect(
      hasValidWGS84Coordinates({ type: 'Point', coordinates: [200, 37.8] })
    ).toBe(false);
  });

  it('accepts valid polygon ring', () => {
    expect(
      hasValidWGS84Coordinates({
        type: 'Polygon',
        coordinates: [
          [
            [-122.4, 37.8],
            [-122.5, 37.8],
            [-122.5, 37.9],
            [-122.4, 37.8],
          ],
        ],
      })
    ).toBe(true);
  });
});
