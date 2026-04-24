import { test, expect } from '@playwright/test';
import { GeoJSONFeatureCollectionSchema } from '@felt-like-it/shared-types';

/**
 * L4 regression — IIIF navPlace is re-validated after external fetch.
 *
 * `annotations.fetchIiifNavPlace` in trpc/routers/annotations.ts runs
 * `GeoJSONFeatureCollectionSchema.safeParse()` on the externally-fetched
 * navPlace before returning. Malformed navPlace → returns null → caller
 * skips writing the field. Mocking an external IIIF server here is
 * expensive; instead we prove the validator used by the handler rejects
 * the known-bad shapes the handler is supposed to guard against.
 */

test.describe('L4: IIIF navPlace validator rejects malformed GeoJSON', () => {
  test('rejects navPlace with wrong type discriminator', () => {
    const result = GeoJSONFeatureCollectionSchema.safeParse({
      type: 'NotAFeatureCollection',
      features: [],
    });
    expect(result.success).toBe(false);
  });

  test('rejects FeatureCollection whose features array is a string', () => {
    const result = GeoJSONFeatureCollectionSchema.safeParse({
      type: 'FeatureCollection',
      features: 'malicious',
    });
    expect(result.success).toBe(false);
  });

  test('rejects feature with malformed geometry coordinates', () => {
    const result = GeoJSONFeatureCollectionSchema.safeParse({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: 'not-an-array' } }],
    });
    expect(result.success).toBe(false);
  });

  test('accepts a valid minimal FeatureCollection', () => {
    const result = GeoJSONFeatureCollectionSchema.safeParse({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [0, 0] } }],
    });
    expect(result.success).toBe(true);
  });
});
