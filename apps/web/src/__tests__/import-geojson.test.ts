// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// --- Module mocks (hoisted before any imports) ---

vi.mock('$lib/server/db/index.js', () => {
  const makeChain = (resolveWith: unknown) => {
    const c: Record<string, unknown> = {
      then: (res: (v: unknown) => unknown) => Promise.resolve(resolveWith).then(res),
    };
    for (const m of ['from', 'where', 'set', 'orderBy']) c[m] = vi.fn(() => c);
    c['values'] = vi.fn(() => ({ returning: vi.fn().mockResolvedValue(resolveWith) }));
    return c;
  };
  return {
    db: {
      insert: vi.fn(() => makeChain([])),
      update: vi.fn(() => makeChain([])),
      select: vi.fn(() => makeChain([])),
      delete: vi.fn(() => makeChain([])),
    },
    layers: {},
    importJobs: {},
    maps: {},
    features: {},
  };
});

vi.mock('$lib/server/geo/queries.js', () => ({
  insertFeatures: vi.fn().mockResolvedValue(undefined),
  getLayerBbox: vi.fn().mockResolvedValue([-122.5, 37.7, -122.4, 37.8]),
}));

// --- Import subjects after mocks are registered ---

import { importGeoJSON } from '../lib/server/import/geojson.js';
import { db } from '$lib/server/db/index.js';
import { insertFeatures, getLayerBbox } from '$lib/server/geo/queries.js';

// --- Helpers ---

const MOCK_LAYER = {
  id: 'layer-uuid',
  mapId: 'map-uuid',
  name: 'Test Layer',
  type: 'polygon' as const,
  style: {},
  visible: true,
  zIndex: 0,
  sourceFileName: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function writeTmpGeoJSON(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'felt-test-'));
  const path = join(dir, 'test.geojson');
  writeFileSync(path, content, 'utf-8');
  return path;
}

const VALID_FEATURE_COLLECTION = JSON.stringify({
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      properties: { name: 'Alpha' },
    },
    {
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [[[2, 2], [3, 2], [3, 3], [2, 2]]] },
      properties: { name: 'Beta' },
    },
  ],
});

const VALID_SINGLE_FEATURE = JSON.stringify({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [0, 0] },
  properties: { label: 'Origin' },
});

// --- Tests ---

describe('importGeoJSON', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: insert returns our mock layer
    vi.mocked(db.insert).mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([MOCK_LAYER]),
      }),
    }) as unknown as ReturnType<typeof db.insert>);

    // Default: update resolves (progress updates)
    vi.mocked(db.update).mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }) as unknown as ReturnType<typeof db.update>);
  });

  it('imports a FeatureCollection and returns the correct count', async () => {
    const path = writeTmpGeoJSON(VALID_FEATURE_COLLECTION);
    const result = await importGeoJSON(path, 'map-uuid', 'Parks', 'job-uuid');

    expect(result.layerId).toBe('layer-uuid');
    expect(result.featureCount).toBe(2);
    expect(insertFeatures).toHaveBeenCalledTimes(1);
    expect(vi.mocked(insertFeatures).mock.calls[0]?.[0]).toBe('layer-uuid');
    expect(vi.mocked(insertFeatures).mock.calls[0]?.[1]).toHaveLength(2);
  });

  it('imports a single Feature (not FeatureCollection)', async () => {
    const path = writeTmpGeoJSON(VALID_SINGLE_FEATURE);
    const result = await importGeoJSON(path, 'map-uuid', 'Point Layer', 'job-uuid');

    expect(result.featureCount).toBe(1);
    expect(insertFeatures).toHaveBeenCalledOnce();
  });

  it('returns the bounding box from getLayerBbox', async () => {
    const path = writeTmpGeoJSON(VALID_FEATURE_COLLECTION);
    const result = await importGeoJSON(path, 'map-uuid', 'Parks', 'job-uuid');

    expect(getLayerBbox).toHaveBeenCalledWith('layer-uuid');
    expect(result.bbox).toEqual([-122.5, 37.7, -122.4, 37.8]);
  });

  it('throws for invalid JSON', async () => {
    const path = writeTmpGeoJSON('not { valid json');
    await expect(importGeoJSON(path, 'map-uuid', 'Bad', 'job-uuid')).rejects.toThrow(
      'Invalid JSON'
    );
  });

  it('throws for a JSON object that is not valid GeoJSON', async () => {
    const path = writeTmpGeoJSON(JSON.stringify({ type: 'NotGeoJSON', data: [] }));
    await expect(importGeoJSON(path, 'map-uuid', 'Bad', 'job-uuid')).rejects.toThrow(
      'Invalid GeoJSON'
    );
  });

  it('throws when the FeatureCollection has no features', async () => {
    const empty = JSON.stringify({ type: 'FeatureCollection', features: [] });
    const path = writeTmpGeoJSON(empty);
    await expect(importGeoJSON(path, 'map-uuid', 'Empty', 'job-uuid')).rejects.toThrow(
      'no features'
    );
  });

  it('throws when the layer insert returns nothing', async () => {
    vi.mocked(db.insert).mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]), // empty → layer is undefined
      }),
    }) as unknown as ReturnType<typeof db.insert>);

    const path = writeTmpGeoJSON(VALID_FEATURE_COLLECTION);
    await expect(importGeoJSON(path, 'map-uuid', 'Parks', 'job-uuid')).rejects.toThrow(
      'Failed to create layer'
    );
  });

  it('inserts in batches of 500 for large feature sets', async () => {
    // Build 1100 features (3 batches: 500 + 500 + 100)
    const features = Array.from({ length: 1100 }, (_, i) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [i * 0.001, 0] },
      properties: { i },
    }));
    const path = writeTmpGeoJSON(JSON.stringify({ type: 'FeatureCollection', features }));
    const result = await importGeoJSON(path, 'map-uuid', 'Bulk', 'job-uuid');

    expect(insertFeatures).toHaveBeenCalledTimes(3);
    expect(result.featureCount).toBe(1100);
  });
});
