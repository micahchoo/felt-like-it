// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { CreateAnnotationObjectSchema } from '@felt-like-it/shared-types';

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const MAP_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const FEATURE_ID = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const LAYER_ID = 'c3d4e5f6-a7b8-9012-cdef-123456789012';
const PARENT_ID = 'd4e5f6a7-b8c9-0123-defa-234567890123';

/** Minimal valid single-text content — reused as anchor-group base. */
const TEXT_CONTENT = {
  kind: 'single' as const,
  body: { type: 'text' as const, text: 'Hello world' },
};

/** Viewport anchor with no bounds — smallest valid anchor. */
const VIEWPORT_ANCHOR = { type: 'viewport' as const };

/** Build the minimal valid base payload, overriding specific fields. */
function base(overrides: object): object {
  return {
    mapId: MAP_ID,
    anchor: VIEWPORT_ANCHOR,
    content: TEXT_CONTENT,
    ...overrides,
  };
}

// ─── Group 1: Anchor types ────────────────────────────────────────────────────

describe('anchor types pass validation', () => {
  it('accepts point anchor with valid WGS84 coordinates', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      base({
        anchor: {
          type: 'point',
          geometry: { type: 'Point', coordinates: [-73.935242, 40.73061] },
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts region anchor with valid 5-point closed polygon ring', () => {
    const ring = [
      [-74, 40],
      [-73, 40],
      [-73, 41],
      [-74, 41],
      [-74, 40],
    ];
    const result = CreateAnnotationObjectSchema.safeParse(
      base({
        anchor: {
          type: 'region',
          geometry: { type: 'Polygon', coordinates: [ring] },
        },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts feature anchor with valid UUID featureId and layerId', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      base({
        anchor: { type: 'feature', featureId: FEATURE_ID, layerId: LAYER_ID },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects feature anchor with non-UUID featureId (vector tile integer ID bug)', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      base({
        anchor: { type: 'feature', featureId: '42', layerId: LAYER_ID },
      }),
    );
    expect(result.success).toBe(false);
    // Error must be on the featureId field, not some other field
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths.some((p) => p.includes('featureId'))).toBe(true);
  });

  it('accepts viewport anchor with no bounds', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      base({ anchor: { type: 'viewport' } }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts viewport anchor with bounds', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      base({
        anchor: { type: 'viewport', bounds: [-74, 40, -73, 41] },
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts measurement anchor with LineString geometry and measurement content', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      base({
        anchor: {
          type: 'measurement',
          geometry: {
            type: 'LineString',
            coordinates: [
              [-74, 40],
              [-73, 41],
            ],
          },
        },
        content: {
          kind: 'single',
          body: {
            type: 'measurement',
            measurementType: 'distance',
            value: 1234.5,
            unit: 'km',
            displayValue: '1.23 km',
          },
        },
      }),
    );
    expect(result.success).toBe(true);
  });
});

// ─── Group 2: Content types ───────────────────────────────────────────────────

describe('content types pass validation', () => {
  function withBody(body: object): object {
    return base({ content: { kind: 'single', body } });
  }

  it('accepts text content', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      withBody({ type: 'text', text: 'Hello world' }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts emoji content', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      withBody({ type: 'emoji', emoji: '📍' }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts gif content', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      withBody({ type: 'gif', url: 'https://example.com/cat.gif' }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts image content', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      withBody({ type: 'image', url: 'https://example.com/photo.jpg' }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts link content', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      withBody({ type: 'link', url: 'https://example.com' }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts iiif content', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      withBody({ type: 'iiif', manifestUrl: 'https://example.com/manifest.json' }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects text content with empty string (min length 1)', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      withBody({ type: 'text', text: '' }),
    );
    expect(result.success).toBe(false);
    const paths = result.error!.issues.map((i) => i.path.join('.'));
    expect(paths.some((p) => p.includes('text'))).toBe(true);
  });
});

// ─── Group 3: Reply with parentId ────────────────────────────────────────────

describe('reply threading', () => {
  it('accepts valid parentId UUID for a reply annotation', () => {
    const result = CreateAnnotationObjectSchema.safeParse(
      base({ parentId: PARENT_ID }),
    );
    expect(result.success).toBe(true);
  });
});
