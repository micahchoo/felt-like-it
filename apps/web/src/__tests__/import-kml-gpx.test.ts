// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drizzleChain } from './test-utils.js';
import type { ParsedFeature } from '@felt-like-it/import-engine';

// ─── Module mocks (hoisted before any imports) ────────────────────────────────

vi.mock('@felt-like-it/import-engine', () => ({
  parseKML: vi.fn(),
  parseGPX: vi.fn(),
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

// ─── Subject imports ──────────────────────────────────────────────────────────

import { importXmlGeo } from '../lib/server/import/xmlgeo.js';
import { parseKML, parseGPX } from '@felt-like-it/import-engine';
import { db } from '$lib/server/db/index.js';
import { insertFeatures, getLayerBbox } from '$lib/server/geo/queries.js';

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Minimal feature shapes for mock return values ──────────────────────────

const POINT_FEATURES: ParsedFeature[] = [
  { geometry: { type: 'Point', coordinates: [13.4, 52.5] } as any, properties: { name: 'Berlin' } },
  { geometry: { type: 'Point', coordinates: [2.3, 48.9] } as any, properties: { name: 'Paris' } },
];

const LINE_FEATURES: ParsedFeature[] = [
  { geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] } as any, properties: { name: 'Route' } },
];

const SINGLE_VALID_FEATURE: ParsedFeature[] = [
  { geometry: { type: 'Point', coordinates: [0, 0] } as any, properties: { name: 'Origin' } },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function setupDbMocks(): void {
  vi.mocked(db.insert).mockImplementation(() => drizzleChain([MOCK_LAYER]));
  vi.mocked(db.update).mockImplementation(() => drizzleChain([]));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('importXmlGeo — KML', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbMocks();
    vi.mocked(parseKML).mockResolvedValue(POINT_FEATURES);
    vi.mocked(parseGPX).mockResolvedValue(POINT_FEATURES);
  });

  it('parses KML and returns correct featureCount', async () => {
    const result = await importXmlGeo('/tmp/cities.kml', MAP_ID, 'Cities', JOB_ID, 'kml');
    expect(result.layerId).toBe(LAYER_ID);
    expect(result.featureCount).toBe(2);
  });

  it('calls parseKML, not parseGPX, for format=kml', async () => {
    await importXmlGeo('/tmp/cities.kml', MAP_ID, 'Cities', JOB_ID, 'kml');
    expect(parseKML).toHaveBeenCalledTimes(1);
    expect(parseGPX).not.toHaveBeenCalled();
  });

  it('passes features to insertFeatures with correct layerId', async () => {
    await importXmlGeo('/tmp/cities.kml', MAP_ID, 'Cities', JOB_ID, 'kml');
    expect(insertFeatures).toHaveBeenCalledOnce();
    const [layerId, features] = vi.mocked(insertFeatures).mock.calls[0] ?? [];
    expect(layerId).toBe(LAYER_ID);
    expect(features).toHaveLength(2);
  });

  it('returns bbox from getLayerBbox', async () => {
    const result = await importXmlGeo('/tmp/cities.kml', MAP_ID, 'Cities', JOB_ID, 'kml');
    expect(getLayerBbox).toHaveBeenCalledWith(LAYER_ID);
    expect(result.bbox).toEqual([-122.5, 37.7, -122.4, 37.8]);
  });

  it('handles features with valid geometry only (parser already filters)', async () => {
    vi.mocked(parseKML).mockResolvedValue(SINGLE_VALID_FEATURE);
    const result = await importXmlGeo('/tmp/mixed.kml', MAP_ID, 'Mixed', JOB_ID, 'kml');
    expect(result.featureCount).toBe(1);
    const [, features] = vi.mocked(insertFeatures).mock.calls[0] ?? [];
    expect(features).toHaveLength(1);
  });

  it('throws when parser returns empty array', async () => {
    vi.mocked(parseKML).mockResolvedValue([]);
    await expect(
      importXmlGeo('/tmp/nulls.kml', MAP_ID, 'Null', JOB_ID, 'kml')
    ).rejects.toThrow('no features with valid geometry');
  });

  it('throws for an empty result', async () => {
    vi.mocked(parseKML).mockResolvedValue([]);
    await expect(
      importXmlGeo('/tmp/empty.kml', MAP_ID, 'Empty', JOB_ID, 'kml')
    ).rejects.toThrow('no features with valid geometry');
  });

  it('throws when layer insert returns nothing', async () => {
    vi.mocked(db.insert).mockImplementation(() => drizzleChain([]));
    await expect(
      importXmlGeo('/tmp/cities.kml', MAP_ID, 'Cities', JOB_ID, 'kml')
    ).rejects.toThrow('Failed to create layer');
  });

  it('inserts large feature sets in batches of 500', async () => {
    const bigFeatures: ParsedFeature[] = Array.from({ length: 1100 }, (_, i) => ({
      geometry: { type: 'Point', coordinates: [i * 0.001, 0] } as any,
      properties: { i },
    }));
    vi.mocked(parseKML).mockResolvedValue(bigFeatures);
    const result = await importXmlGeo('/tmp/big.kml', MAP_ID, 'Bulk', JOB_ID, 'kml');
    expect(insertFeatures).toHaveBeenCalledTimes(3); // 500 + 500 + 100
    expect(result.featureCount).toBe(1100);
  });
});

describe('importXmlGeo — GPX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbMocks();
    vi.mocked(parseKML).mockResolvedValue(POINT_FEATURES);
    vi.mocked(parseGPX).mockResolvedValue(LINE_FEATURES);
  });

  it('parses GPX and returns correct featureCount', async () => {
    const result = await importXmlGeo('/tmp/track.gpx', MAP_ID, 'Track', JOB_ID, 'gpx');
    expect(result.layerId).toBe(LAYER_ID);
    expect(result.featureCount).toBe(1);
  });

  it('calls parseGPX, not parseKML, for format=gpx', async () => {
    await importXmlGeo('/tmp/track.gpx', MAP_ID, 'Track', JOB_ID, 'gpx');
    expect(parseGPX).toHaveBeenCalledTimes(1);
    expect(parseKML).not.toHaveBeenCalled();
  });

  it('throws when GPX produces no features', async () => {
    vi.mocked(parseGPX).mockResolvedValue([]);
    await expect(
      importXmlGeo('/tmp/bad.gpx', MAP_ID, 'Bad', JOB_ID, 'gpx')
    ).rejects.toThrow('no features with valid geometry');
  });
});
