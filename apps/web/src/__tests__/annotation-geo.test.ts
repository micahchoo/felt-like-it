// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  deriveAnnotationPins,
  deriveAnnotationRegions,
  deriveAnnotationPaths,
  deriveAnnotatedFeaturesIndex,
  deriveMeasurementData,
} from '$lib/stores/annotation-geo.svelte.js';
import type { AnnotationRow } from '$lib/stores/annotation-geo.svelte.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeBase(overrides: Partial<AnnotationRow> = {}): AnnotationRow {
  return {
    id: 'aaaaaaaa-0000-0000-0000-000000000001',
    mapId: 'bbbbbbbb-0000-0000-0000-000000000001',
    parentId: null,
    authorId: null,
    authorName: 'Alice',
    anchor: { type: 'point', geometry: { type: 'Point', coordinates: [10, 20, 0] } },
    content: { kind: 'single', body: { type: 'text', text: 'hello' } },
    templateId: null,
    ordinal: 0,
    version: 1,
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makePoint(id: string, coords: [number, number, number] = [10, 20, 0], overrides: Partial<AnnotationRow> = {}): AnnotationRow {
  return makeBase({
    id,
    anchor: { type: 'point', geometry: { type: 'Point', coordinates: coords } },
    ...overrides,
  });
}

function makeRegion(id: string, overrides: Partial<AnnotationRow> = {}): AnnotationRow {
  return makeBase({
    id,
    anchor: {
      type: 'region',
      geometry: {
        type: 'Polygon',
        coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
      },
    },
    ...overrides,
  });
}

function makePath(id: string, overrides: Partial<AnnotationRow> = {}): AnnotationRow {
  return makeBase({
    id,
    anchor: {
      type: 'path',
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] },
    },
    ...overrides,
  });
}

function makeFeature(id: string, featureId: string, layerId: string, overrides: Partial<AnnotationRow> = {}): AnnotationRow {
  return makeBase({
    id,
    anchor: { type: 'feature', featureId, layerId },
    ...overrides,
  });
}

function makeMeasurement(id: string, overrides: Partial<AnnotationRow> = {}): AnnotationRow {
  return makeBase({
    id,
    anchor: {
      type: 'measurement',
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
    },
    content: {
      // @ts-expect-error — measurement body not in AnnotationContent union; test-only shape
      kind: 'single',
      body: { type: 'measurement', displayValue: '1.41 km' },
    },
    ...overrides,
  });
}

// ─── deriveAnnotationPins ─────────────────────────────────────────────────────

describe('deriveAnnotationPins', () => {
  it('returns empty FeatureCollection for empty input', () => {
    const result = deriveAnnotationPins([]);
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(0);
  });

  it('maps point-anchored annotations to Point features', () => {
    const rows = [makePoint('id-1', [15, 25, 0])];
    const result = deriveAnnotationPins(rows);
    expect(result.features).toHaveLength(1);
    const f = result.features[0]!;
    expect(f.id).toBe('id-1');
    expect(f.geometry.type).toBe('Point');
    expect(f.geometry.coordinates).toEqual([15, 25]);
  });

  it('strips the Z coordinate from 3D geometries', () => {
    const rows = [makePoint('id-1', [10, 20, 999])];
    const result = deriveAnnotationPins(rows);
    expect(result.features[0]!.geometry.coordinates).toHaveLength(2);
  });

  it('embeds authorName, createdAt, contentJson, anchorType in properties', () => {
    const createdAt = new Date('2024-06-01T12:00:00Z');
    const rows = [makePoint('id-1', [0, 0, 0], { authorName: 'Bob', createdAt })];
    const result = deriveAnnotationPins(rows);
    const props = result.features[0]!.properties;
    expect(props.authorName).toBe('Bob');
    expect(props.createdAt).toBe(createdAt.toISOString());
    expect(props.anchorType).toBe('point');
    expect(typeof props.contentJson).toBe('string');
  });

  it('excludes replies (rows with non-null parentId)', () => {
    const rows = [
      makePoint('root-id'),
      makePoint('reply-id', [10, 20, 0], { parentId: 'root-id' }),
    ];
    const result = deriveAnnotationPins(rows);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.id).toBe('root-id');
  });

  it('excludes region-anchored annotations', () => {
    const rows = [makePoint('pt-1'), makeRegion('reg-1')];
    const result = deriveAnnotationPins(rows);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.id).toBe('pt-1');
  });

  it('handles multiple point annotations', () => {
    const rows = [makePoint('a'), makePoint('b'), makePoint('c')];
    const result = deriveAnnotationPins(rows);
    expect(result.features).toHaveLength(3);
  });
});

// ─── deriveAnnotationRegions ──────────────────────────────────────────────────

describe('deriveAnnotationRegions', () => {
  it('returns empty FeatureCollection for empty input', () => {
    const result = deriveAnnotationRegions([]);
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(0);
  });

  it('maps region-anchored annotations to Polygon features', () => {
    const rows = [makeRegion('reg-1')];
    const result = deriveAnnotationRegions(rows);
    expect(result.features).toHaveLength(1);
    const f = result.features[0]!;
    expect(f.id).toBe('reg-1');
    expect(f.geometry.type).toBe('Polygon');
  });

  it('excludes replies (parentId set)', () => {
    const rows = [
      makeRegion('root'),
      makeRegion('reply', { parentId: 'root' }),
    ];
    const result = deriveAnnotationRegions(rows);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.id).toBe('root');
  });

  it('excludes point-anchored annotations', () => {
    const rows = [makeRegion('reg-1'), makePoint('pt-1')];
    const result = deriveAnnotationRegions(rows);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.id).toBe('reg-1');
  });

  it('embeds metadata in properties', () => {
    const rows = [makeRegion('reg-1', { authorName: 'Carol' })];
    const result = deriveAnnotationRegions(rows);
    expect(result.features[0]!.properties.authorName).toBe('Carol');
    expect(result.features[0]!.properties.anchorType).toBe('region');
  });
});

// ─── deriveAnnotatedFeaturesIndex ────────────────────────────────────────────

describe('deriveAnnotatedFeaturesIndex', () => {
  it('returns empty map for empty input', () => {
    const result = deriveAnnotatedFeaturesIndex([]);
    expect(result.size).toBe(0);
  });

  it('counts a single feature-anchored annotation', () => {
    const rows = [makeFeature('ann-1', 'feat-1', 'layer-1')];
    const result = deriveAnnotatedFeaturesIndex(rows);
    expect(result.get('feat-1')).toEqual({ layerId: 'layer-1', count: 1 });
  });

  it('accumulates count for multiple annotations on the same feature', () => {
    const rows = [
      makeFeature('ann-1', 'feat-1', 'layer-1'),
      makeFeature('ann-2', 'feat-1', 'layer-1'),
      makeFeature('ann-3', 'feat-1', 'layer-1'),
    ];
    const result = deriveAnnotatedFeaturesIndex(rows);
    expect(result.get('feat-1')?.count).toBe(3);
  });

  it('tracks different features independently', () => {
    const rows = [
      makeFeature('ann-1', 'feat-1', 'layer-1'),
      makeFeature('ann-2', 'feat-2', 'layer-1'),
    ];
    const result = deriveAnnotatedFeaturesIndex(rows);
    expect(result.get('feat-1')?.count).toBe(1);
    expect(result.get('feat-2')?.count).toBe(1);
    expect(result.size).toBe(2);
  });

  it('ignores non-feature-anchored annotations', () => {
    const rows = [makePoint('pt-1'), makeRegion('reg-1'), makeFeature('ann-1', 'feat-1', 'layer-1')];
    const result = deriveAnnotatedFeaturesIndex(rows);
    expect(result.size).toBe(1);
  });
});

// ─── deriveMeasurementData ────────────────────────────────────────────────────

describe('deriveMeasurementData', () => {
  it('returns empty FeatureCollection for empty input', () => {
    const result = deriveMeasurementData([]);
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(0);
  });

  it('maps measurement-anchored annotations to features', () => {
    const rows = [makeMeasurement('m-1')];
    const result = deriveMeasurementData(rows);
    expect(result.features).toHaveLength(1);
    const f = result.features[0]!;
    expect(f.type).toBe('Feature');
    expect(f.properties['annotationId']).toBe('m-1');
    expect(f.properties['id']).toBe('m-1');
  });

  it('extracts displayValue as label from measurement body', () => {
    const rows = [makeMeasurement('m-1')];
    const result = deriveMeasurementData(rows);
    expect(result.features[0]!.properties['label']).toBe('1.41 km');
  });

  it('sets empty label when content is not a measurement body', () => {
    const rows = [makeMeasurement('m-1', {
      content: { kind: 'single', body: { type: 'text', text: 'note' } },
    })];
    const result = deriveMeasurementData(rows);
    expect(result.features[0]!.properties['label']).toBe('');
  });

  it('excludes point/region/feature annotations', () => {
    const rows = [makePoint('pt'), makeRegion('reg'), makeMeasurement('m-1')];
    const result = deriveMeasurementData(rows);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.properties['annotationId']).toBe('m-1');
  });

  it('preserves geometry from anchor', () => {
    const rows = [makeMeasurement('m-1')];
    const result = deriveMeasurementData(rows);
    const geom = result.features[0]!.geometry as { type: string; coordinates: unknown };
    expect(geom.type).toBe('LineString');
  });
});

// ─── Mixed input ──────────────────────────────────────────────────────────────

describe('mixed input separation', () => {
  it('each derivation correctly filters its own anchor type', () => {
    const rows = [
      makePoint('pt-1'),
      makeRegion('reg-1'),
      makeFeature('feat-ann-1', 'feat-1', 'layer-1'),
      makeMeasurement('meas-1'),
      makePoint('reply', [0, 0, 0], { parentId: 'pt-1' }),
    ];

    const pins = deriveAnnotationPins(rows);
    const regions = deriveAnnotationRegions(rows);
    const index = deriveAnnotatedFeaturesIndex(rows);
    const measurements = deriveMeasurementData(rows);

    // Pins: only root point annotations
    expect(pins.features.map((f) => f.id)).toEqual(['pt-1']);

    // Regions: only root region annotations
    expect(regions.features.map((f) => f.id)).toEqual(['reg-1']);

    // Index: only feature-anchored
    expect(index.size).toBe(1);
    expect(index.get('feat-1')?.count).toBe(1);

    // Measurements: only measurement-anchored
    expect(measurements.features).toHaveLength(1);
    expect(measurements.features[0]!.properties['annotationId']).toBe('meas-1');
  });
});

// ─── deriveAnnotationPaths ───────────────────────────────────────────────────

describe('deriveAnnotationPaths', () => {
  it('returns empty FeatureCollection for empty input', () => {
    const result = deriveAnnotationPaths([]);
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(0);
  });

  it('maps path-anchored annotations to LineString features', () => {
    const result = deriveAnnotationPaths([makePath('p-1')]);
    expect(result.features).toHaveLength(1);
    const f = result.features[0]!;
    expect(f.id).toBe('p-1');
    expect(f.geometry.type).toBe('LineString');
    expect(f.geometry.coordinates).toHaveLength(3);
  });

  it('excludes non-path anchors', () => {
    const result = deriveAnnotationPaths([makePath('p-1'), makeRegion('r-1')]);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.id).toBe('p-1');
  });

  it('excludes replies (parentId set)', () => {
    const result = deriveAnnotationPaths([
      makePath('root'),
      makePath('reply', { parentId: 'root' }),
    ]);
    expect(result.features).toHaveLength(1);
    expect(result.features[0]!.id).toBe('root');
  });

  it('folds style onto path properties', () => {
    const result = deriveAnnotationPaths([
      makePath('p-1', { style: { strokeColor: '#ff9900', strokeWidth: 4 } }),
    ]);
    const props = result.features[0]!.properties;
    expect(props.strokeColor).toBe('#ff9900');
    expect(props.strokeWidth).toBe(4);
  });
});

// ─── Style folding (per-annotation paint expression support) ─────────────────
// Renderer paint expressions of the form `['coalesce', ['get', 'strokeColor'], DEFAULT]`
// require the fields to live flat on feature.properties. Gap here → annotations
// silently render with defaults even when a user set a style.

describe('style folding into feature properties', () => {
  it('folds AnnotationStyle fields flat onto pin properties', () => {
    const pin = makePoint('pin-1', [10, 20, 0], {
      style: {
        strokeColor: '#ff0000',
        strokeWidth: 3,
        strokeOpacity: 0.5,
        fillColor: '#00ff00',
        fillOpacity: 0.8,
        strokeStyle: 'dashed',
        showLabel: false,
      },
    });
    const { properties } = deriveAnnotationPins([pin]).features[0]!;
    expect(properties.strokeColor).toBe('#ff0000');
    expect(properties.strokeWidth).toBe(3);
    expect(properties.strokeOpacity).toBe(0.5);
    expect(properties.fillColor).toBe('#00ff00');
    expect(properties.fillOpacity).toBe(0.8);
    expect(properties.strokeStyle).toBe('dashed');
    expect(properties.showLabel).toBe(false);
  });

  it('folds AnnotationStyle fields flat onto region properties', () => {
    const region = makeRegion('reg-1', {
      style: { fillColor: '#123456', fillOpacity: 0.4 },
    });
    const { properties } = deriveAnnotationRegions([region]).features[0]!;
    expect(properties.fillColor).toBe('#123456');
    expect(properties.fillOpacity).toBe(0.4);
  });

  it('omits absent style keys so coalesce fallbacks apply (null style)', () => {
    const pin = makePoint('pin-2', [10, 20, 0], { style: null });
    const { properties } = deriveAnnotationPins([pin]).features[0]!;
    // No style fields leak in — renderer coalesces to defaults.
    expect(properties).not.toHaveProperty('strokeColor');
    expect(properties).not.toHaveProperty('fillColor');
  });

  it('sparse style: only set fields appear on properties', () => {
    const pin = makePoint('pin-3', [10, 20, 0], {
      style: { strokeWidth: 5 },
    });
    const { properties } = deriveAnnotationPins([pin]).features[0]!;
    expect(properties.strokeWidth).toBe(5);
    expect(properties).not.toHaveProperty('strokeColor');
    expect(properties).not.toHaveProperty('fillOpacity');
  });
});
