// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  anchorToGeometry,
  annotationsToFeatureCollection,
} from '$lib/server/export/annotations.js';
import type { AnnotationObject } from '@felt-like-it/shared-types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeAnnotation(overrides: Partial<AnnotationObject> = {}): AnnotationObject {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    mapId: 'bbbbbbbb-0000-0000-0000-000000000001',
    parentId: null,
    authorId: 'cccccccc-0000-0000-0000-000000000001',
    authorName: 'Alice',
    anchor: { type: 'point', geometry: { type: 'Point', coordinates: [10, 20] } },
    content: { kind: 'single', body: { type: 'text', text: 'hello world' } },
    templateId: null,
    ordinal: 0,
    version: 1,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

// ─── anchorToGeometry ────────────────────────────────────────────────────────

describe('anchorToGeometry', () => {
  it('returns Point geometry for point anchors', () => {
    const geo = anchorToGeometry({ type: 'point', geometry: { type: 'Point', coordinates: [1, 2] } });
    expect(geo).toEqual({ type: 'Point', coordinates: [1, 2] });
  });

  it('returns Polygon geometry for region anchors', () => {
    const ring: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0]];
    const geo = anchorToGeometry({ type: 'region', geometry: { type: 'Polygon', coordinates: [ring] } });
    expect(geo).toEqual({ type: 'Polygon', coordinates: [ring] });
  });

  it('returns geometry for measurement anchors', () => {
    const geo = anchorToGeometry({
      type: 'measurement',
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    });
    expect(geo).toEqual({ type: 'LineString', coordinates: [[0, 0], [1, 1]] });
  });

  it('returns null for feature anchors', () => {
    const geo = anchorToGeometry({
      type: 'feature',
      featureId: 'aaaaaaaa-0000-0000-0000-000000000001',
      layerId: 'bbbbbbbb-0000-0000-0000-000000000001',
    });
    expect(geo).toBeNull();
  });

  it('returns null for viewport anchors', () => {
    const geo = anchorToGeometry({ type: 'viewport' });
    expect(geo).toBeNull();
  });
});

// ─── annotationsToFeatureCollection ──────────────────────────────────────────

describe('annotationsToFeatureCollection', () => {
  it('builds a valid FeatureCollection from point annotations', () => {
    const annotations = [makeAnnotation()];
    const fc = annotationsToFeatureCollection(annotations);

    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(1);

    const f = fc.features[0]!;
    expect(f.type).toBe('Feature');
    expect(f.id).toBe('aaaaaaaa-0000-0000-0000-000000000001');
    expect(f.geometry).toEqual({ type: 'Point', coordinates: [10, 20] });
    expect(f.properties?.authorName).toBe('Alice');
    expect(f.properties?.text).toBe('hello world');
    expect(f.properties?.anchorType).toBe('point');
  });

  it('includes region-anchored annotations', () => {
    const ring: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0]];
    const fc = annotationsToFeatureCollection([
      makeAnnotation({
        id: 'reg-1',
        anchor: { type: 'region', geometry: { type: 'Polygon', coordinates: [ring] } },
      }),
    ]);

    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry.type).toBe('Polygon');
  });

  it('excludes feature-anchored annotations (no standalone geometry)', () => {
    const fc = annotationsToFeatureCollection([
      makeAnnotation({
        id: 'feat-1',
        anchor: {
          type: 'feature',
          featureId: 'aaaaaaaa-0000-0000-0000-000000000002',
          layerId: 'bbbbbbbb-0000-0000-0000-000000000002',
        },
      }),
    ]);
    expect(fc.features).toHaveLength(0);
  });

  it('excludes viewport-anchored annotations', () => {
    const fc = annotationsToFeatureCollection([
      makeAnnotation({ id: 'vp-1', anchor: { type: 'viewport' } }),
    ]);
    expect(fc.features).toHaveLength(0);
  });

  it('handles mixed anchor types — only exportable ones appear', () => {
    const ring: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 0]];
    const annotations = [
      makeAnnotation({ id: 'pt-1' }),
      makeAnnotation({
        id: 'reg-1',
        anchor: { type: 'region', geometry: { type: 'Polygon', coordinates: [ring] } },
      }),
      makeAnnotation({
        id: 'feat-1',
        anchor: {
          type: 'feature',
          featureId: 'aaaaaaaa-0000-0000-0000-000000000002',
          layerId: 'bbbbbbbb-0000-0000-0000-000000000002',
        },
      }),
      makeAnnotation({ id: 'vp-1', anchor: { type: 'viewport' } }),
    ];

    const fc = annotationsToFeatureCollection(annotations);
    expect(fc.features).toHaveLength(2);
    const ids = fc.features.map((f) => f.id);
    expect(ids).toContain('pt-1');
    expect(ids).toContain('reg-1');
  });

  it('returns empty FeatureCollection for empty input', () => {
    const fc = annotationsToFeatureCollection([]);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(0);
  });

  it('preserves timestamps as ISO strings', () => {
    const created = new Date('2025-06-15T12:00:00Z');
    const updated = new Date('2025-06-16T14:30:00Z');
    const fc = annotationsToFeatureCollection([
      makeAnnotation({ createdAt: created, updatedAt: updated }),
    ]);
    expect(fc.features[0]!.properties?.createdAt).toBe('2025-06-15T12:00:00.000Z');
    expect(fc.features[0]!.properties?.updatedAt).toBe('2025-06-16T14:30:00.000Z');
  });

  it('extracts text from slotted content', () => {
    const fc = annotationsToFeatureCollection([
      makeAnnotation({
        content: {
          kind: 'slotted',
          slots: {
            title: { type: 'text', text: 'Title here' },
            body: { type: 'text', text: 'Body here' },
            empty: null,
          },
        },
      }),
    ]);
    expect(fc.features[0]!.properties?.text).toBe('Title here | Body here');
    expect(fc.features[0]!.properties?.contentType).toBe('slotted');
  });

  it('includes measurement-anchored annotations', () => {
    const fc = annotationsToFeatureCollection([
      makeAnnotation({
        id: 'meas-1',
        anchor: {
          type: 'measurement',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        },
        content: {
          kind: 'single',
          body: { type: 'measurement', measurementType: 'distance', displayValue: '3.2 km', value: 3200, unit: 'meters' },
        },
      }),
    ]);
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0]!.geometry.type).toBe('LineString');
    expect(fc.features[0]!.properties?.text).toBe('3.2 km');
  });
});
