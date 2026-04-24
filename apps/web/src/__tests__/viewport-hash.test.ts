// @vitest-environment node
/**
 * Tests for the F13.1 viewport-hash codec.
 *
 * Covers:
 *  1. parse/serialize round-trip preserves values within precision.
 *  2. parse rejects malformed input (empty, wrong shape, NaN, out-of-range)
 *     and returns null — caller falls back to owner viewport.
 *  3. serialize rounds to documented precision (zoom: 2dp, lat/lng: 5dp).
 *  4. -0 is normalised to 0 so the hash doesn't carry a sign artefact.
 */
import { describe, it, expect } from 'vitest';
import {
  parseViewportHash,
  serializeViewportHash,
  type HashViewport,
} from '$lib/utils/viewport-hash.js';

describe('parseViewportHash', () => {
  it('parses a well-formed #zoom/lat/lng hash', () => {
    const v = parseViewportHash('#10/40.7128/-74.006');
    expect(v).toEqual({ zoom: 10, lat: 40.7128, lng: -74.006 });
  });

  it('parses a hash without the leading #', () => {
    const v = parseViewportHash('10/40.7128/-74.006');
    expect(v).toEqual({ zoom: 10, lat: 40.7128, lng: -74.006 });
  });

  it('returns null for empty input', () => {
    expect(parseViewportHash('')).toBeNull();
  });

  it('returns null for null/undefined', () => {
    expect(parseViewportHash(null)).toBeNull();
    expect(parseViewportHash(undefined)).toBeNull();
  });

  it('returns null when there are too few segments', () => {
    expect(parseViewportHash('#10/40.7128')).toBeNull();
  });

  it('returns null when there are too many segments', () => {
    expect(parseViewportHash('#10/40.7128/-74.006/extra')).toBeNull();
  });

  it('returns null when any segment is non-numeric', () => {
    expect(parseViewportHash('#abc/40.7128/-74.006')).toBeNull();
    expect(parseViewportHash('#10/notanumber/x')).toBeNull();
    expect(parseViewportHash('#10/40.7128/NaN')).toBeNull();
  });

  it('returns null for out-of-range zoom', () => {
    expect(parseViewportHash('#-1/0/0')).toBeNull();
    expect(parseViewportHash('#25/0/0')).toBeNull();
  });

  it('returns null for out-of-range lat', () => {
    expect(parseViewportHash('#10/91/0')).toBeNull();
    expect(parseViewportHash('#10/-91/0')).toBeNull();
  });

  it('returns null for out-of-range lng', () => {
    expect(parseViewportHash('#10/0/181')).toBeNull();
    expect(parseViewportHash('#10/0/-181')).toBeNull();
  });

  it('accepts the precise zoom = 0 and zoom = 24 boundaries', () => {
    expect(parseViewportHash('#0/0/0')).toEqual({ zoom: 0, lat: 0, lng: 0 });
    expect(parseViewportHash('#24/0/0')).toEqual({ zoom: 24, lat: 0, lng: 0 });
  });
});

describe('serializeViewportHash', () => {
  it('emits #zoom/lat/lng with the leading #', () => {
    const out = serializeViewportHash({ zoom: 10, lat: 40.7128, lng: -74.006 });
    expect(out).toBe('#10/40.7128/-74.006');
  });

  it('rounds zoom to 2 decimal places', () => {
    const out = serializeViewportHash({ zoom: 10.123456, lat: 0, lng: 0 });
    expect(out).toBe('#10.12/0/0');
  });

  it('rounds lat/lng to 5 decimal places', () => {
    const out = serializeViewportHash({ zoom: 5, lat: 40.71280123, lng: -74.00601 });
    expect(out).toBe('#5/40.7128/-74.00601');
  });

  it('normalises -0 lng to 0 so the hash has no sign artefact', () => {
    const out = serializeViewportHash({ zoom: 5, lat: 0, lng: -0 });
    expect(out).toBe('#5/0/0');
  });

  it('preserves negative non-zero values', () => {
    const out = serializeViewportHash({ zoom: 5, lat: -33.86882, lng: -151.20929 });
    expect(out).toBe('#5/-33.86882/-151.20929');
  });
});

describe('round-trip', () => {
  it('parse(serialize(v)) preserves v within precision', () => {
    const v: HashViewport = { zoom: 12.34, lat: 51.50735, lng: -0.12776 };
    const round = parseViewportHash(serializeViewportHash(v));
    expect(round).toEqual(v);
  });

  it('round-trip handles equator + prime meridian (potential -0 trap)', () => {
    const v: HashViewport = { zoom: 0, lat: 0, lng: 0 };
    expect(parseViewportHash(serializeViewportHash(v))).toEqual(v);
  });

  it('round-trip handles antimeridian boundary', () => {
    const v: HashViewport = { zoom: 3, lat: 0, lng: 180 };
    expect(parseViewportHash(serializeViewportHash(v))).toEqual(v);
  });

  it('round-trip drops sub-precision noise', () => {
    const v: HashViewport = { zoom: 10.123456789, lat: 40.71280123, lng: -74.006001 };
    const round = parseViewportHash(serializeViewportHash(v));
    // Zoom rounded to 2dp, lat/lng to 5dp
    expect(round).toEqual({ zoom: 10.12, lat: 40.7128, lng: -74.006 });
  });
});
