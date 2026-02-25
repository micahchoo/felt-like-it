// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drizzleChain } from './test-utils.js';

// ─── Module mocks ────────────────────────────────────────────────────────────

const mockParseShp = vi.fn();
const mockShpjs = Object.assign(vi.fn(), { parseShp: mockParseShp });

vi.mock('shpjs', () => ({ default: mockShpjs }));

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.from('fake-shp-data')),
}));

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

// ─── Subject imports ────────────────────────────────────────────────────────

import { importShapefile } from '../lib/server/import/shapefile.js';
import { db } from '$lib/server/db/index.js';
import { insertFeatures, getLayerBbox } from '$lib/server/geo/queries.js';

// ─── Constants ──────────────────────────────────────────────────────────────

const MAP_ID = 'map-uuid-1';
const LAYER_ID = 'layer-uuid-1';
const JOB_ID = 'job-uuid-1';

const MOCK_LAYER = {
  id: LAYER_ID,
  mapId: MAP_ID,
  name: 'Test Layer',
  type: 'point' as const,
  style: {},
  visible: true,
  zIndex: 0,
  sourceFileName: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

type MockGeom = { type: string; coordinates: unknown };
type MockFeature = { type: 'Feature'; geometry: MockGeom | null; properties: Record<string, unknown> | null };
type MockFC = { type: 'FeatureCollection'; features: MockFeature[] };

const POINT_FC: MockFC = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-122.4, 37.8] }, properties: { name: 'SF' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [-118.2, 34.1] }, properties: { name: 'LA' } },
  ],
};

const POLYGON_FC: MockFC = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] }, properties: { name: 'Square' } },
  ],
};

function setupDbMocks(): void {
  vi.mocked(db.insert).mockImplementation(() => drizzleChain([MOCK_LAYER]));
  vi.mocked(db.update).mockImplementation(() => drizzleChain([]));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('importShapefile — .zip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbMocks();
    mockShpjs.mockResolvedValue(POINT_FC);
  });

  it('parses zip shapefile and returns correct featureCount', async () => {
    const result = await importShapefile('/tmp/cities.zip', MAP_ID, 'Cities', JOB_ID);
    expect(result.layerId).toBe(LAYER_ID);
    expect(result.featureCount).toBe(2);
  });

  it('passes features to insertFeatures with correct layerId', async () => {
    await importShapefile('/tmp/cities.zip', MAP_ID, 'Cities', JOB_ID);
    expect(insertFeatures).toHaveBeenCalledOnce();
    const [layerId, features] = vi.mocked(insertFeatures).mock.calls[0] ?? [];
    expect(layerId).toBe(LAYER_ID);
    expect(features).toHaveLength(2);
  });

  it('returns bbox from getLayerBbox', async () => {
    const result = await importShapefile('/tmp/cities.zip', MAP_ID, 'Cities', JOB_ID);
    expect(getLayerBbox).toHaveBeenCalledWith(LAYER_ID);
    expect(result.bbox).toEqual([-122.5, 37.7, -122.4, 37.8]);
  });

  it('handles shpjs returning an array of FeatureCollections', async () => {
    mockShpjs.mockResolvedValue([POINT_FC, POLYGON_FC]);
    const result = await importShapefile('/tmp/multi.zip', MAP_ID, 'Multi', JOB_ID);
    expect(result.featureCount).toBe(3);
  });

  it('filters out null-geometry features', async () => {
    const mixedFc: MockFC = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: null, properties: { name: 'No Geom' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Origin' } },
      ],
    };
    mockShpjs.mockResolvedValue(mixedFc);
    const result = await importShapefile('/tmp/mixed.zip', MAP_ID, 'Mixed', JOB_ID);
    expect(result.featureCount).toBe(1);
  });

  it('throws when shapefile contains no features', async () => {
    const emptyFc: MockFC = { type: 'FeatureCollection', features: [] };
    mockShpjs.mockResolvedValue(emptyFc);
    await expect(
      importShapefile('/tmp/empty.zip', MAP_ID, 'Empty', JOB_ID)
    ).rejects.toThrow('Shapefile contains no features');
  });

  it('throws when all features have null geometry', async () => {
    const nullFc: MockFC = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: {} }],
    };
    mockShpjs.mockResolvedValue(nullFc);
    await expect(
      importShapefile('/tmp/nulls.zip', MAP_ID, 'Nulls', JOB_ID)
    ).rejects.toThrow('no features with valid geometry');
  });
});

describe('importShapefile — raw .shp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbMocks();
    mockParseShp.mockResolvedValue([
      { type: 'Point', coordinates: [1, 2] },
      { type: 'Point', coordinates: [3, 4] },
    ]);
  });

  it('parses raw .shp via parseShp and returns correct featureCount', async () => {
    const result = await importShapefile('/tmp/raw.shp', MAP_ID, 'Raw', JOB_ID);
    expect(result.layerId).toBe(LAYER_ID);
    expect(result.featureCount).toBe(2);
    expect(mockParseShp).toHaveBeenCalledOnce();
    expect(mockShpjs).not.toHaveBeenCalled();
  });
});

describe('importShapefile — error cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbMocks();
  });

  it('throws for unsupported file extension', async () => {
    await expect(
      importShapefile('/tmp/data.geojson', MAP_ID, 'Bad', JOB_ID)
    ).rejects.toThrow('Unsupported Shapefile extension');
  });
});
