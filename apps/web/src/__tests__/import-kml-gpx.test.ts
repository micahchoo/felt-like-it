// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Module mocks (hoisted before any imports) ────────────────────────────────

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('<kml/>'),
}));

vi.mock('@xmldom/xmldom', () => ({
  DOMParser: class MockDOMParser {
    parseFromString(_str: string, _type: string): unknown {
      return {};
    }
  },
}));

vi.mock('@tmcw/togeojson', () => ({
  kml: vi.fn(),
  gpx: vi.fn(),
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
import { kml as mockKml, gpx as mockGpx } from '@tmcw/togeojson';
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

// ─── Minimal FeatureCollection shapes for mock return values ──────────────────

type MockGeom = { type: string; coordinates: number[] | number[][] | number[][][] };
type MockFeature = { type: 'Feature'; geometry: MockGeom | null; properties: Record<string, unknown> | null };
type MockFC = { type: 'FeatureCollection'; features: MockFeature[] };

const POINT_FC: MockFC = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [13.4, 52.5] }, properties: { name: 'Berlin' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [2.3, 48.9] }, properties: { name: 'Paris' } },
  ],
};

const LINE_FC: MockFC = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1], [2, 0]] }, properties: { name: 'Route' } },
  ],
};

const NULL_GEOM_MIXED_FC: MockFC = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', geometry: null, properties: { name: 'Folder — no geometry' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'Origin' } },
  ],
};

const NULL_GEOM_ONLY_FC: MockFC = {
  type: 'FeatureCollection',
  features: [{ type: 'Feature', geometry: null, properties: { name: 'No Geometry' } }],
};

const EMPTY_FC: MockFC = { type: 'FeatureCollection', features: [] };

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Coerce a MockFC to whatever return type vi.mocked().mockReturnValue expects.
// kml() returns FeatureCollection<Geometry|null> and gpx() returns FeatureCollection<Geometry>,
// so a direct cast from MockFC (which has geometry: MockGeom|null) fails without
// going via unknown. Explicit cast at each call site matches the pattern used elsewhere
// in the test suite (e.g. `as unknown as ReturnType<typeof db.insert>`).
function asKmlReturn(fc: MockFC): ReturnType<typeof mockKml> {
  return fc as unknown as ReturnType<typeof mockKml>;
}
function asGpxReturn(fc: MockFC): ReturnType<typeof mockGpx> {
  return fc as unknown as ReturnType<typeof mockGpx>;
}

function setupDbMocks(): void {
  vi.mocked(db.insert).mockImplementation(
    () =>
      ({
        values: vi.fn().mockReturnValue({
          returning: vi.fn().mockResolvedValue([MOCK_LAYER]),
        }),
      }) as unknown as ReturnType<typeof db.insert>
  );

  vi.mocked(db.update).mockImplementation(
    () =>
      ({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }) as unknown as ReturnType<typeof db.update>
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('importXmlGeo — KML', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbMocks();
    vi.mocked(mockKml).mockReturnValue(asKmlReturn(POINT_FC));
    vi.mocked(mockGpx).mockReturnValue(asGpxReturn(POINT_FC));
  });

  it('parses KML and returns correct featureCount', async () => {
    const result = await importXmlGeo('/tmp/cities.kml', MAP_ID, 'Cities', JOB_ID, 'kml');
    expect(result.layerId).toBe(LAYER_ID);
    expect(result.featureCount).toBe(2);
  });

  it('calls togeojson.kml, not gpx, for format=kml', async () => {
    await importXmlGeo('/tmp/cities.kml', MAP_ID, 'Cities', JOB_ID, 'kml');
    expect(mockKml).toHaveBeenCalledTimes(1);
    expect(mockGpx).not.toHaveBeenCalled();
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

  it('drops null-geometry features and counts only valid ones', async () => {
    vi.mocked(mockKml).mockReturnValue(asKmlReturn(NULL_GEOM_MIXED_FC));
    const result = await importXmlGeo('/tmp/mixed.kml', MAP_ID, 'Mixed', JOB_ID, 'kml');
    expect(result.featureCount).toBe(1);
    const [, features] = vi.mocked(insertFeatures).mock.calls[0] ?? [];
    expect(features).toHaveLength(1);
  });

  it('throws when all features have null geometry', async () => {
    vi.mocked(mockKml).mockReturnValue(asKmlReturn(NULL_GEOM_ONLY_FC));
    await expect(
      importXmlGeo('/tmp/nulls.kml', MAP_ID, 'Null', JOB_ID, 'kml')
    ).rejects.toThrow('KML file contains no features with valid geometry');
  });

  it('throws for an empty FeatureCollection', async () => {
    vi.mocked(mockKml).mockReturnValue(asKmlReturn(EMPTY_FC));
    await expect(
      importXmlGeo('/tmp/empty.kml', MAP_ID, 'Empty', JOB_ID, 'kml')
    ).rejects.toThrow('no features with valid geometry');
  });

  it('throws when layer insert returns nothing', async () => {
    vi.mocked(db.insert).mockImplementation(
      () =>
        ({
          values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([]),
          }),
        }) as unknown as ReturnType<typeof db.insert>
    );
    await expect(
      importXmlGeo('/tmp/cities.kml', MAP_ID, 'Cities', JOB_ID, 'kml')
    ).rejects.toThrow('Failed to create layer');
  });

  it('inserts large feature sets in batches of 500', async () => {
    const bigFc: MockFC = {
      type: 'FeatureCollection',
      features: Array.from({ length: 1100 }, (_, i) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point', coordinates: [i * 0.001, 0] },
        properties: { i },
      })),
    };
    vi.mocked(mockKml).mockReturnValue(asKmlReturn(bigFc));
    const result = await importXmlGeo('/tmp/big.kml', MAP_ID, 'Bulk', JOB_ID, 'kml');
    expect(insertFeatures).toHaveBeenCalledTimes(3); // 500 + 500 + 100
    expect(result.featureCount).toBe(1100);
  });
});

describe('importXmlGeo — GPX', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbMocks();
    vi.mocked(mockKml).mockReturnValue(asKmlReturn(POINT_FC));
    vi.mocked(mockGpx).mockReturnValue(asGpxReturn(LINE_FC));
  });

  it('parses GPX and returns correct featureCount', async () => {
    const result = await importXmlGeo('/tmp/track.gpx', MAP_ID, 'Track', JOB_ID, 'gpx');
    expect(result.layerId).toBe(LAYER_ID);
    expect(result.featureCount).toBe(1);
  });

  it('calls togeojson.gpx, not kml, for format=gpx', async () => {
    await importXmlGeo('/tmp/track.gpx', MAP_ID, 'Track', JOB_ID, 'gpx');
    expect(mockGpx).toHaveBeenCalledTimes(1);
    expect(mockKml).not.toHaveBeenCalled();
  });

  it('throws when GPX produces only null-geometry features', async () => {
    vi.mocked(mockGpx).mockReturnValue(asGpxReturn(NULL_GEOM_ONLY_FC));
    await expect(
      importXmlGeo('/tmp/bad.gpx', MAP_ID, 'Bad', JOB_ID, 'gpx')
    ).rejects.toThrow('GPX file contains no features with valid geometry');
  });
});
