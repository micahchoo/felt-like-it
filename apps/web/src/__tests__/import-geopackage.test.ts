// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoisted mock state ────────────────────────────────────────────────────────
// vi.hoisted runs before vi.mock factories so mockSqlExec is initialised
// before the sql.js factory closes over it.
const { mockSqlExec } = vi.hoisted(() => ({
  mockSqlExec: vi.fn(),
}));

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue(Buffer.alloc(0)),
}));

vi.mock('sql.js', () => ({
  default: vi.fn(async () => ({
    Database: class MockDatabase {
      constructor(_buf: Uint8Array) {}
      exec(sqlStr: string) {
        // TYPE_DEBT: vi.fn() without generics types args as never; cast to allow call.
        return (mockSqlExec as (s: string) => unknown)(sqlStr);
      }
      close() {}
    },
  })),
}));

vi.mock('@felt-like-it/geo-engine', () => ({
  generateAutoStyle: vi.fn().mockReturnValue({ type: 'simple', color: '#3b82f6' }),
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
  insertWkbFeatures: vi.fn().mockResolvedValue(undefined),
  getLayerBbox: vi.fn().mockResolvedValue([-122.5, 37.7, -122.4, 37.8]),
}));

// ─── Subject imports ──────────────────────────────────────────────────────────

import { importGeoPackage, parseGpkgBlob, gpkgGeomTypeToLayerType } from '../lib/server/import/geopackage.js';
import { db } from '$lib/server/db/index.js';
import { insertWkbFeatures, getLayerBbox } from '$lib/server/geo/queries.js';

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

// ─── GPKG blob construction helpers ──────────────────────────────────────────

/**
 * Build a minimal GeoPackage Binary Header prepended to a WKB payload.
 * flags byte: bit 0 = little-endian, bits 1-3 = envelope indicator, bit 4 = empty flag.
 */
function makeGpkgBlob(
  wkb: Uint8Array,
  srid: number,
  options: { envelopeIndicator?: 0 | 1 | 2 | 3 | 4; emptyFlag?: boolean } = {}
): Uint8Array {
  const { envelopeIndicator = 0, emptyFlag = false } = options;
  const envelopeSizes = [0, 32, 48, 48, 64] as const;
  const envelopeSize = envelopeSizes[envelopeIndicator] ?? 0;

  let flags = 0x01; // little-endian
  flags |= (envelopeIndicator & 0x7) << 1;
  if (emptyFlag) flags |= 0x10;

  const totalLen = 8 + envelopeSize + wkb.length;
  const buf = new Uint8Array(totalLen);
  buf[0] = 0x47; // 'G'
  buf[1] = 0x50; // 'P'
  buf[2] = 0x00; // version
  buf[3] = flags;
  new DataView(buf.buffer).setInt32(4, srid, true);
  // envelope bytes remain zero (valid minimal envelope)
  buf.set(wkb, 8 + envelopeSize);
  return buf;
}

/** Minimal WKB Point (little-endian). */
function makeWkbPoint(x: number, y: number): Uint8Array {
  const buf = new Uint8Array(21);
  const view = new DataView(buf.buffer);
  buf[0] = 0x01; // little-endian
  view.setUint32(1, 1, true); // geometry type: Point = 1
  view.setFloat64(5, x, true);
  view.setFloat64(13, y, true);
  return buf;
}

const POINT_BLOB = makeGpkgBlob(makeWkbPoint(13.4, 52.5), 4326);
const POINT_BLOB_2 = makeGpkgBlob(makeWkbPoint(2.3, 48.9), 4326);
const EMPTY_GEOM_BLOB = makeGpkgBlob(makeWkbPoint(0, 0), 4326, { emptyFlag: true });

// sql.js QueryExecResult type alias
type QRow = (number | string | Uint8Array | null)[];
type QExecResult = { columns: string[]; values: QRow[] };

// ─── Mock helpers ─────────────────────────────────────────────────────────────

/**
 * Set up sql.js exec mock using mockImplementation rather than
 * mockReturnValueOnce. This avoids order-sensitive queue bugs caused by
 * vi.clearAllMocks() not flushing the returnValueOnce queue.
 *
 * Dispatches on SQL string content:
 *   gpkg_contents query     → contentsRows
 *   gpkg_geometry_columns   → geomColRows
 *   SELECT * FROM …         → featureRows
 */
function setSqlMocks(opts: {
  contentsRows?: QRow[];
  geomColRows?: QRow[];
  featureRows?: QRow[];
  featureCols?: string[];
} = {}): void {
  const {
    contentsRows = [['test_table', 4326]],
    geomColRows = [['geom', 'POINT', 4326]],
    featureRows = [[1, POINT_BLOB, 'Berlin']],
    featureCols = ['fid', 'geom', 'name'],
  } = opts;

  mockSqlExec.mockImplementation((sqlStr: string): QExecResult[] => {
    if (sqlStr.includes('gpkg_contents')) {
      return contentsRows.length === 0
        ? []
        : [{ columns: ['table_name', 'srs_id'], values: contentsRows }];
    }
    if (sqlStr.includes('gpkg_geometry_columns')) {
      return geomColRows.length === 0
        ? []
        : [{ columns: ['column_name', 'geometry_type_name', 'srs_id'], values: geomColRows }];
    }
    // Feature table SELECT * query
    return featureRows.length === 0
      ? []
      : [{ columns: featureCols, values: featureRows }];
  });
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
        set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }),
      }) as unknown as ReturnType<typeof db.update>
  );
}

// ─── parseGpkgBlob unit tests ─────────────────────────────────────────────────

describe('parseGpkgBlob', () => {
  it('returns wkbBytes and srid for a valid little-endian blob (SRID 4326)', () => {
    const wkb = makeWkbPoint(13.4, 52.5);
    const blob = makeGpkgBlob(wkb, 4326);
    const result = parseGpkgBlob(blob);
    expect(result).not.toBeNull();
    expect(result?.srid).toBe(4326);
    expect(result?.wkbBytes).toEqual(wkb);
  });

  it('returns null when blob is shorter than 8 bytes', () => {
    expect(parseGpkgBlob(new Uint8Array(7))).toBeNull();
  });

  it('returns null when magic bytes are wrong', () => {
    const bad = new Uint8Array(12);
    bad[0] = 0x00;
    bad[1] = 0x00;
    expect(parseGpkgBlob(bad)).toBeNull();
  });

  it('returns null when empty-geometry flag (bit 4) is set', () => {
    expect(parseGpkgBlob(EMPTY_GEOM_BLOB)).toBeNull();
  });

  it('correctly skips XY envelope (indicator 1 → 32 byte offset)', () => {
    const wkb = makeWkbPoint(1.0, 2.0);
    const blob = makeGpkgBlob(wkb, 4326, { envelopeIndicator: 1 });
    const result = parseGpkgBlob(blob);
    expect(result).not.toBeNull();
    expect(result?.wkbBytes).toEqual(wkb);
  });

  it('returns SRID 0 when the srid field is zero', () => {
    const blob = makeGpkgBlob(makeWkbPoint(0, 0), 0);
    const result = parseGpkgBlob(blob);
    expect(result?.srid).toBe(0);
  });

  it('returns null when blob length is too short after envelope', () => {
    // envelope indicator 4 = 64 bytes; blob has no space after 8-byte header
    const buf = new Uint8Array(8);
    buf[0] = 0x47;
    buf[1] = 0x50;
    buf[3] = 0x01 | (4 << 1); // LE + envelope indicator 4
    expect(parseGpkgBlob(buf)).toBeNull();
  });
});

// ─── gpkgGeomTypeToLayerType unit tests ───────────────────────────────────────

describe('gpkgGeomTypeToLayerType', () => {
  it('POINT → point', () => expect(gpkgGeomTypeToLayerType('POINT')).toBe('point'));
  it('POINTZ → point (Z suffix stripped)', () => expect(gpkgGeomTypeToLayerType('POINTZ')).toBe('point'));
  it('POINTM → point (M suffix stripped)', () => expect(gpkgGeomTypeToLayerType('POINTM')).toBe('point'));
  it('POINTZM → point (ZM suffix stripped)', () => expect(gpkgGeomTypeToLayerType('POINTZM')).toBe('point'));
  it('MULTIPOINT → point', () => expect(gpkgGeomTypeToLayerType('MULTIPOINT')).toBe('point'));
  it('LINESTRING → line', () => expect(gpkgGeomTypeToLayerType('LINESTRING')).toBe('line'));
  it('MULTILINESTRING → line', () => expect(gpkgGeomTypeToLayerType('MULTILINESTRING')).toBe('line'));
  it('POLYGON → polygon', () => expect(gpkgGeomTypeToLayerType('POLYGON')).toBe('polygon'));
  it('MULTIPOLYGON → polygon', () => expect(gpkgGeomTypeToLayerType('MULTIPOLYGON')).toBe('polygon'));
  it('GEOMETRYCOLLECTION → mixed', () => expect(gpkgGeomTypeToLayerType('GEOMETRYCOLLECTION')).toBe('mixed'));
  it('unknown type → mixed', () => expect(gpkgGeomTypeToLayerType('SURFACE')).toBe('mixed'));
  it('case-insensitive', () => expect(gpkgGeomTypeToLayerType('linestring')).toBe('line'));
});

// ─── importGeoPackage integration tests ───────────────────────────────────────

describe('importGeoPackage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDbMocks();
    // vi.clearAllMocks() does NOT reset mockImplementation — re-set it
    // explicitly so each test starts with the default sql behaviour.
    setSqlMocks();
    vi.mocked(insertWkbFeatures).mockResolvedValue(undefined);
    vi.mocked(getLayerBbox).mockResolvedValue([-122.5, 37.7, -122.4, 37.8]);
  });

  it('parses GeoPackage and returns correct featureCount', async () => {
    const result = await importGeoPackage('/tmp/test.gpkg', MAP_ID, 'Cities', JOB_ID);
    expect(result.layerId).toBe(LAYER_ID);
    expect(result.featureCount).toBe(1);
  });

  it('calls insertWkbFeatures with correct layerId', async () => {
    await importGeoPackage('/tmp/test.gpkg', MAP_ID, 'Cities', JOB_ID);
    expect(insertWkbFeatures).toHaveBeenCalledOnce();
    const [layerId] = vi.mocked(insertWkbFeatures).mock.calls[0] ?? [];
    expect(layerId).toBe(LAYER_ID);
  });

  it('passes correct wkbBytes, srid, and properties to insertWkbFeatures', async () => {
    await importGeoPackage('/tmp/test.gpkg', MAP_ID, 'Cities', JOB_ID);
    const [, features] = vi.mocked(insertWkbFeatures).mock.calls[0] ?? [];
    expect(features).toHaveLength(1);
    expect(features?.[0]?.wkbBytes).toEqual(makeWkbPoint(13.4, 52.5));
    expect(features?.[0]?.srid).toBe(4326);
    expect(features?.[0]?.properties).toEqual({ name: 'Berlin' });
  });

  it('excludes fid column from feature properties', async () => {
    await importGeoPackage('/tmp/test.gpkg', MAP_ID, 'Cities', JOB_ID);
    const [, features] = vi.mocked(insertWkbFeatures).mock.calls[0] ?? [];
    expect(features?.[0]?.properties).not.toHaveProperty('fid');
  });

  it('excludes ogc_fid column from feature properties', async () => {
    setSqlMocks({
      featureCols: ['ogc_fid', 'geom', 'name'],
      featureRows: [[1, POINT_BLOB, 'Berlin']],
    });
    await importGeoPackage('/tmp/test.gpkg', MAP_ID, 'Cities', JOB_ID);
    const [, features] = vi.mocked(insertWkbFeatures).mock.calls[0] ?? [];
    expect(features?.[0]?.properties).not.toHaveProperty('ogc_fid');
  });

  it('returns bbox from getLayerBbox', async () => {
    const result = await importGeoPackage('/tmp/test.gpkg', MAP_ID, 'Cities', JOB_ID);
    expect(getLayerBbox).toHaveBeenCalledWith(LAYER_ID);
    expect(result.bbox).toEqual([-122.5, 37.7, -122.4, 37.8]);
  });

  it('handles two features from two rows', async () => {
    setSqlMocks({
      featureRows: [
        [1, POINT_BLOB, 'Berlin'],
        [2, POINT_BLOB_2, 'Paris'],
      ],
    });
    const result = await importGeoPackage('/tmp/cities.gpkg', MAP_ID, 'Cities', JOB_ID);
    expect(result.featureCount).toBe(2);
  });

  it('drops rows where geometry column is not a Uint8Array (null)', async () => {
    setSqlMocks({
      featureRows: [
        [1, POINT_BLOB, 'Valid'],
        [2, null, 'NoGeom'],
      ],
    });
    const result = await importGeoPackage('/tmp/test.gpkg', MAP_ID, 'Mixed', JOB_ID);
    expect(result.featureCount).toBe(1);
    const [, features] = vi.mocked(insertWkbFeatures).mock.calls[0] ?? [];
    expect(features).toHaveLength(1);
    expect(features?.[0]?.properties?.['name']).toBe('Valid');
  });

  it('drops rows where parseGpkgBlob returns null (empty-geometry flag)', async () => {
    setSqlMocks({
      featureRows: [
        [1, EMPTY_GEOM_BLOB, 'Empty'],
        [2, POINT_BLOB, 'Valid'],
      ],
    });
    const result = await importGeoPackage('/tmp/mixed.gpkg', MAP_ID, 'Mixed', JOB_ID);
    expect(result.featureCount).toBe(1);
  });

  it('uses tableSrid from gpkg_geometry_columns when blob srid is 0', async () => {
    const blobSridZero = makeGpkgBlob(makeWkbPoint(0, 0), 0);
    setSqlMocks({
      contentsRows: [['test_table', 3857]],
      geomColRows: [['geom', 'POINT', 3857]],
      featureRows: [[1, blobSridZero]],
      featureCols: ['fid', 'geom'],
    });
    await importGeoPackage('/tmp/test.gpkg', MAP_ID, 'Layer', JOB_ID);
    const [, features] = vi.mocked(insertWkbFeatures).mock.calls[0] ?? [];
    // srid=0 in blob header → falls back to tableSrid=3857
    expect(features?.[0]?.srid).toBe(3857);
  });

  it('inserts large feature sets in batches of 500', async () => {
    const bigRows: QRow[] = Array.from({ length: 1100 }, (_, i) => [
      i,
      makeGpkgBlob(makeWkbPoint(i * 0.001, 0), 4326),
      `feat-${i}`,
    ]);
    setSqlMocks({ featureRows: bigRows });
    const result = await importGeoPackage('/tmp/big.gpkg', MAP_ID, 'Bulk', JOB_ID);
    expect(insertWkbFeatures).toHaveBeenCalledTimes(3); // 500 + 500 + 100
    expect(result.featureCount).toBe(1100);
  });

  it('throws when gpkg_contents has no feature tables', async () => {
    setSqlMocks({ contentsRows: [] });
    await expect(
      importGeoPackage('/tmp/empty.gpkg', MAP_ID, 'Layer', JOB_ID)
    ).rejects.toThrow('GeoPackage contains no feature tables');
  });

  it('throws when table has no entry in gpkg_geometry_columns', async () => {
    setSqlMocks({ geomColRows: [] });
    await expect(
      importGeoPackage('/tmp/bad.gpkg', MAP_ID, 'Layer', JOB_ID)
    ).rejects.toThrow('gpkg_geometry_columns');
  });

  it('throws when all geometry blobs are invalid or empty', async () => {
    setSqlMocks({
      featureRows: [
        [1, EMPTY_GEOM_BLOB, 'X'],
        [2, null, 'Y'],
      ],
    });
    await expect(
      importGeoPackage('/tmp/invalid.gpkg', MAP_ID, 'Layer', JOB_ID)
    ).rejects.toThrow('no features with valid geometry');
  });

  it('throws for invalid table name (SQL injection guard)', async () => {
    setSqlMocks({ contentsRows: [["DROP TABLE users; --", 4326]] });
    await expect(
      importGeoPackage('/tmp/malicious.gpkg', MAP_ID, 'Layer', JOB_ID)
    ).rejects.toThrow('Invalid GeoPackage table name');
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
      importGeoPackage('/tmp/test.gpkg', MAP_ID, 'Layer', JOB_ID)
    ).rejects.toThrow('Failed to create layer');
  });
});
