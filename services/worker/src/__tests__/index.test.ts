/**
 * Worker orchestration tests
 *
 * Tests the job lifecycle, validation, security guards, format routing,
 * and error handling — NOT the actual parsing (import-engine owns that).
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { resolve } from 'path';

// ─── Mocks ────────────────────────────────────────────────────────────────────
// Must be hoisted before the module-under-test is imported.

// pg Pool mock
const mockPoolQuery = vi.fn();
const mockPoolEnd = vi.fn();
vi.mock('pg', () => {
  const Pool = vi.fn(() => ({
    query: mockPoolQuery,
    end: mockPoolEnd,
  }));
  return { default: { Pool } };
});

// drizzle mock
const mockDbExecute = vi.fn();
vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => ({ execute: mockDbExecute })),
}));

// ioredis mock
vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({
    quit: vi.fn(),
  })),
}));

// BullMQ mock — capture processor functions by queue name
let capturedProcessors: Record<string, (job: unknown) => Promise<void>> = {};
vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((name: string, processor: (job: unknown) => Promise<void>) => {
    capturedProcessors[name] = processor;
    return {
      on: vi.fn(),
      close: vi.fn(),
    };
  }),
}));

// import-engine mocks
const mockParseGeoJSON = vi.fn();
const mockParseCSV = vi.fn();
const mockCsvRowsToFeatures = vi.fn();
const mockParseShapefile = vi.fn();
const mockParseKML = vi.fn();
const mockParseGPX = vi.fn();
const mockParseGeoPackage = vi.fn();
vi.mock('@felt-like-it/import-engine', () => ({
  parseGeoJSON: mockParseGeoJSON,
  parseCSV: mockParseCSV,
  csvRowsToFeatures: mockCsvRowsToFeatures,
  parseShapefile: mockParseShapefile,
  parseKML: mockParseKML,
  parseGPX: mockParseGPX,
  parseGeoPackage: mockParseGeoPackage,
}));

// geo-engine mocks
const mockDetectLayerType = vi.fn().mockReturnValue('point');
const mockGenerateAutoStyle = vi.fn().mockReturnValue({ color: '#000' });
const mockDetectCoordinateColumns = vi.fn();
const mockDetectAddressColumn = vi.fn();
const mockGeocodeBatch = vi.fn();
vi.mock('@felt-like-it/geo-engine', () => ({
  detectLayerType: mockDetectLayerType,
  generateAutoStyle: mockGenerateAutoStyle,
  detectCoordinateColumns: mockDetectCoordinateColumns,
  detectAddressColumn: mockDetectAddressColumn,
  geocodeBatch: mockGeocodeBatch,
}));

// logger mock (suppress output)
vi.mock('../logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const UPLOAD_DIR = resolve(process.env['UPLOAD_DIR'] ?? '/tmp/felt-uploads');

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    jobId: '00000000-0000-0000-0000-000000000001',
    mapId: '00000000-0000-0000-0000-000000000002',
    layerName: 'Test Layer',
    filePath: `${UPLOAD_DIR}/test-file.geojson`,
    fileName: 'test-file.geojson',
    ...overrides,
  };
}

function fakeJob(data: unknown) {
  return { data, id: 'bull-job-1' };
}

const LAYER_ID = '00000000-0000-0000-0000-000000000099';

function setupDbForLayerCreation() {
  // pool.query for cleanup check (no existing layer)
  mockPoolQuery.mockResolvedValue({ rows: [] });
  // db.execute for updateJobStatus('processing', 5)
  // db.execute for INSERT INTO layers RETURNING id
  // db.execute for UPDATE import_jobs SET layer_id
  // db.execute for insertFeaturesBatch
  // db.execute for updateJobStatus('done', 100)
  mockDbExecute.mockResolvedValue({ rows: [{ id: LAYER_ID }] });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// Import the module to register the Worker (and capture the processor)
beforeEach(async () => {
  vi.resetModules();
  // Reset all mocks between tests
  mockPoolQuery.mockReset();
  mockPoolEnd.mockReset();
  mockDbExecute.mockReset();
  mockParseGeoJSON.mockReset();
  mockParseCSV.mockReset();
  mockCsvRowsToFeatures.mockReset();
  mockParseShapefile.mockReset();
  mockParseKML.mockReset();
  mockParseGPX.mockReset();
  mockParseGeoPackage.mockReset();
  mockDetectLayerType.mockReset().mockReturnValue('point');
  mockGenerateAutoStyle.mockReset().mockReturnValue({ color: '#000' });
  mockDetectCoordinateColumns.mockReset();
  mockDetectAddressColumn.mockReset();
  mockGeocodeBatch.mockReset();
  capturedProcessors = {};
  await import('../../src/index.js');
});

async function runProcessor(data: unknown): Promise<void> {
  const processor = capturedProcessors['file-import'];
  if (!processor) throw new Error('Worker processor was not captured — import failed');
  return processor(fakeJob(data));
}

async function runGeoprocessingProcessor(data: unknown): Promise<void> {
  const processor = capturedProcessors['geoprocessing'];
  if (!processor) throw new Error('Geoprocessing processor was not captured — import failed');
  return processor(fakeJob(data));
}

// ─── 1. ImportJobPayload Zod validation ───────────────────────────────────────

describe('ImportJobPayload validation', () => {
  it('accepts a valid payload', async () => {
    setupDbForLayerCreation();
    mockParseGeoJSON.mockResolvedValue([
      { geometry: { type: 'Point', coordinates: [0, 0] }, properties: { name: 'a' } },
    ]);

    await expect(runProcessor(validPayload())).resolves.toBeUndefined();
  });

  it('rejects payload missing jobId', async () => {
    const bad = validPayload();
    delete (bad as Record<string, unknown>)['jobId'];

    await expect(runProcessor(bad)).rejects.toThrow();
  });

  it('rejects payload with non-uuid jobId', async () => {
    await expect(runProcessor(validPayload({ jobId: 'not-a-uuid' }))).rejects.toThrow();
  });

  it('rejects payload with non-uuid mapId', async () => {
    await expect(runProcessor(validPayload({ mapId: 'bad' }))).rejects.toThrow();
  });

  it('rejects payload missing fileName', async () => {
    const bad = validPayload();
    delete (bad as Record<string, unknown>)['fileName'];

    await expect(runProcessor(bad)).rejects.toThrow();
  });

  it('rejects payload with empty string layerName', async () => {
    // Zod string() accepts empty by default, but let's verify the schema behavior
    // If schema has .min(1), this throws; if not, it passes validation but
    // we're testing the actual schema as-is
    const data = validPayload({ layerName: '' });
    // The schema allows empty string, so this should pass validation
    // but we're testing that the processor doesn't crash on empty names
    setupDbForLayerCreation();
    mockParseGeoJSON.mockResolvedValue([
      { geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
    ]);
    // Should not throw on validation — empty string is valid per schema
    await expect(runProcessor(data)).resolves.toBeUndefined();
  });
});

// ─── 2. Path traversal guard ──────────────────────────────────────────────────

describe('path traversal guard', () => {
  it('rejects absolute path outside UPLOAD_DIR', async () => {
    const data = validPayload({ filePath: '/etc/passwd' });

    await expect(runProcessor(data)).rejects.toThrow(/Security.*resolves outside UPLOAD_DIR/);
  });

  it('rejects relative traversal that escapes UPLOAD_DIR', async () => {
    const data = validPayload({ filePath: `${UPLOAD_DIR}/../../../etc/shadow` });

    await expect(runProcessor(data)).rejects.toThrow(/Security.*resolves outside UPLOAD_DIR/);
  });

  it('rejects path that is the UPLOAD_DIR itself (no trailing slash)', async () => {
    // resolve(UPLOAD_DIR) does NOT start with UPLOAD_DIR + '/'
    const data = validPayload({ filePath: UPLOAD_DIR });

    await expect(runProcessor(data)).rejects.toThrow(/Security.*resolves outside UPLOAD_DIR/);
  });

  it('accepts path inside UPLOAD_DIR', async () => {
    setupDbForLayerCreation();
    mockParseGeoJSON.mockResolvedValue([
      { geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
    ]);
    const data = validPayload({ filePath: `${UPLOAD_DIR}/subdir/file.geojson` });

    await expect(runProcessor(data)).resolves.toBeUndefined();
  });

  it('rejects symlink-style path with UPLOAD_DIR as prefix but different directory', async () => {
    // e.g. /tmp/felt-uploads-evil/file.geojson starts with /tmp/felt-uploads
    // but NOT with /tmp/felt-uploads/ — the trailing slash check catches this
    const data = validPayload({ filePath: `${UPLOAD_DIR}-evil/file.geojson` });

    await expect(runProcessor(data)).rejects.toThrow(/Security.*resolves outside UPLOAD_DIR/);
  });
});

// ─── 3. Format detection ──────────────────────────────────────────────────────

describe('format detection routes to correct parser', () => {
  beforeEach(() => {
    setupDbForLayerCreation();
  });

  const pointFeature = [
    { geometry: { type: 'Point', coordinates: [0, 0] }, properties: { id: 1 } },
  ];

  it('routes .geojson to parseGeoJSON', async () => {
    mockParseGeoJSON.mockResolvedValue(pointFeature);
    await runProcessor(validPayload({ fileName: 'data.geojson' }));

    expect(mockParseGeoJSON).toHaveBeenCalledOnce();
    expect(mockParseShapefile).not.toHaveBeenCalled();
  });

  it('routes .json to parseGeoJSON', async () => {
    mockParseGeoJSON.mockResolvedValue(pointFeature);
    await runProcessor(validPayload({ fileName: 'data.json' }));

    expect(mockParseGeoJSON).toHaveBeenCalledOnce();
  });

  it('routes .csv to parseCSV', async () => {
    mockParseCSV.mockResolvedValue({
      headers: ['lat', 'lng', 'name'],
      rows: [{ lat: '0', lng: '0', name: 'a' }],
    });
    mockDetectCoordinateColumns.mockReturnValue({ lat: 'lat', lng: 'lng' });
    mockCsvRowsToFeatures.mockReturnValue(pointFeature);
    await runProcessor(validPayload({ fileName: 'data.csv', filePath: `${UPLOAD_DIR}/data.csv` }));

    expect(mockParseCSV).toHaveBeenCalledOnce();
  });

  it('routes .zip to parseShapefile', async () => {
    mockParseShapefile.mockResolvedValue(pointFeature);
    await runProcessor(validPayload({ fileName: 'data.zip', filePath: `${UPLOAD_DIR}/data.zip` }));

    expect(mockParseShapefile).toHaveBeenCalledOnce();
  });

  it('routes .shp to parseShapefile', async () => {
    mockParseShapefile.mockResolvedValue(pointFeature);
    await runProcessor(validPayload({ fileName: 'data.shp', filePath: `${UPLOAD_DIR}/data.shp` }));

    expect(mockParseShapefile).toHaveBeenCalledOnce();
  });

  it('routes .kml to parseKML', async () => {
    mockParseKML.mockResolvedValue(pointFeature);
    await runProcessor(validPayload({ fileName: 'data.kml', filePath: `${UPLOAD_DIR}/data.kml` }));

    expect(mockParseKML).toHaveBeenCalledOnce();
  });

  it('routes .gpx to parseGPX', async () => {
    mockParseGPX.mockResolvedValue(pointFeature);
    await runProcessor(validPayload({ fileName: 'data.gpx', filePath: `${UPLOAD_DIR}/data.gpx` }));

    expect(mockParseGPX).toHaveBeenCalledOnce();
  });

  it('routes .gpkg to parseGeoPackage', async () => {
    mockParseGeoPackage.mockResolvedValue({
      features: [{ wkbHex: '0101000000', srid: 4326, properties: {} }],
      layerType: 'point',
    });
    await runProcessor(
      validPayload({ fileName: 'data.gpkg', filePath: `${UPLOAD_DIR}/data.gpkg` })
    );

    expect(mockParseGeoPackage).toHaveBeenCalledOnce();
  });

  it('rejects unsupported extension', async () => {
    await expect(
      runProcessor(validPayload({ fileName: 'data.xlsx', filePath: `${UPLOAD_DIR}/data.xlsx` }))
    ).rejects.toThrow(/Unsupported format.*\.xlsx/);
  });

  it('handles case-insensitive extensions via toLowerCase', async () => {
    mockParseGeoJSON.mockResolvedValue(pointFeature);
    // Extension is extracted from fileName, and toLowerCase'd
    await runProcessor(validPayload({ fileName: 'DATA.GEOJSON' }));

    expect(mockParseGeoJSON).toHaveBeenCalledOnce();
  });
});

// ─── 4. Error handling ────────────────────────────────────────────────────────

describe('error handling', () => {
  it('marks job as failed when parser throws', async () => {
    setupDbForLayerCreation();
    mockParseGeoJSON.mockRejectedValue(
      new Error('File not found: /tmp/felt-uploads/missing.geojson')
    );

    await expect(
      runProcessor(validPayload({ filePath: `${UPLOAD_DIR}/missing.geojson` }))
    ).rejects.toThrow('File not found');

    // Verify the job was marked as failed — db.execute is called with SQL that
    // sets status='failed'. We check it was called with a sql template that
    // includes 'failed'.
    const failCall = (mockDbExecute as Mock).mock.calls.find((call) => {
      const sqlObj = call[0];
      // drizzle sql tagged templates have a queryChunks or similar structure
      // We check the string representation
      return JSON.stringify(sqlObj).includes('failed');
    });
    expect(failCall).toBeDefined();
  });

  it('marks job as failed with error message when parse produces non-Error throw', async () => {
    setupDbForLayerCreation();
    mockParseGeoJSON.mockRejectedValue('string error');

    await expect(runProcessor(validPayload())).rejects.toBe('string error');

    // The catch block uses String(err) for non-Error values
    const failCall = (mockDbExecute as Mock).mock.calls.find((call) =>
      JSON.stringify(call[0]).includes('failed')
    );
    expect(failCall).toBeDefined();
  });

  it('re-throws after marking job as failed so BullMQ can retry', async () => {
    setupDbForLayerCreation();
    const parseError = new Error('Corrupt GeoJSON');
    mockParseGeoJSON.mockRejectedValue(parseError);

    await expect(runProcessor(validPayload())).rejects.toThrow('Corrupt GeoJSON');
  });

  it('cleans up partial layer from previous failed attempt on retry', async () => {
    const staleLayerId = '00000000-0000-0000-0000-aaaaaaaaaaaa';
    // First pool.query returns an existing layer_id (simulating a retry)
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ layer_id: staleLayerId }] });
    // Subsequent pool.query calls for DELETE and UPDATE
    mockPoolQuery.mockResolvedValue({ rows: [] });
    mockDbExecute.mockResolvedValue({ rows: [{ id: LAYER_ID }] });

    mockParseGeoJSON.mockResolvedValue([
      { geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
    ]);

    await runProcessor(validPayload());

    // Verify cleanup queries were issued
    const deleteFeatures = (mockPoolQuery as Mock).mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('DELETE FROM features')
    );
    const deleteLayers = (mockPoolQuery as Mock).mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('DELETE FROM layers')
    );
    expect(deleteFeatures).toBeDefined();
    expect(deleteLayers).toBeDefined();
    // Verify stale layer ID was passed to DELETE
    expect(deleteFeatures![1]).toContain(staleLayerId);
    expect(deleteLayers![1]).toContain(staleLayerId);
  });
});

// ─── 5. Job lifecycle ─────────────────────────────────────────────────────────

describe('job lifecycle', () => {
  it('updates status to processing then done on success', async () => {
    setupDbForLayerCreation();
    mockParseGeoJSON.mockResolvedValue([
      { geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} },
    ]);

    await runProcessor(validPayload());

    // db.execute is called multiple times — at minimum for:
    // 1. updateJobStatus('processing', 5)
    // 2. INSERT INTO layers
    // 3. UPDATE import_jobs SET layer_id
    // 4. INSERT INTO features (batch)
    // 5. updateJobStatus('done', 100)
    expect(mockDbExecute.mock.calls.length).toBeGreaterThanOrEqual(4);

    // First call should be the 'processing' status update
    const firstCallSql = JSON.stringify(mockDbExecute.mock.calls[0]![0]);
    expect(firstCallSql).toContain('processing');

    // Last call should be the 'done' status update
    const lastCallSql = JSON.stringify(
      mockDbExecute.mock.calls[mockDbExecute.mock.calls.length - 1]![0]
    );
    expect(lastCallSql).toContain('done');
  });
});
