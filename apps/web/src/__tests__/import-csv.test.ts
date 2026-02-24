// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// --- Module mocks ---

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
    delete: vi.fn(),
  },
  layers: {},
  importJobs: {},
  maps: {},
  features: {},
}));

vi.mock('$lib/server/geo/queries.js', () => ({
  insertFeatures: vi.fn().mockResolvedValue(undefined),
  getLayerBbox: vi.fn().mockResolvedValue([-74.1, 40.6, -73.9, 40.8]),
}));

// Partial mock — preserve all real geo-engine functions, only stub geocodeBatch.
// importOriginal() returns unknown without a type parameter; cast to Record<string,unknown>
// so the spread compiles. The concrete geocodeBatch import below re-types it correctly.
vi.mock('@felt-like-it/geo-engine', async (importOriginal) => {
  const original = await importOriginal() as Record<string, unknown>;
  return { ...original, geocodeBatch: vi.fn() };
});

import { importCSV } from '../lib/server/import/csv.js';
import { db } from '$lib/server/db/index.js';
import { insertFeatures } from '$lib/server/geo/queries.js';
import { geocodeBatch } from '@felt-like-it/geo-engine';

// --- Helpers ---

const MOCK_LAYER = {
  id: 'layer-csv',
  mapId: 'map-uuid',
  name: 'CSV Layer',
  type: 'point' as const,
  style: {},
  visible: true,
  zIndex: 0,
  sourceFileName: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function writeTmpCSV(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'felt-csv-test-'));
  const path = join(dir, 'test.csv');
  writeFileSync(path, content, 'utf-8');
  return path;
}

// --- Tests ---

describe('importCSV', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(db.insert).mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([MOCK_LAYER]),
      }),
    }) as unknown as ReturnType<typeof db.insert>);

    vi.mocked(db.update).mockImplementation(() => ({
      set: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }) as unknown as ReturnType<typeof db.update>);
  });

  it('parses a CSV with lat/lng column names', async () => {
    const csv = 'name,lat,lng\nCentral Park,40.7829,-73.9654\nTimes Square,40.7580,-73.9855';
    const path = writeTmpCSV(csv);
    const result = await importCSV(path, 'map-uuid', 'NYC', 'job-uuid');

    expect(result.featureCount).toBe(2);
    expect(result.layerId).toBe('layer-csv');
    const features = vi.mocked(insertFeatures).mock.calls[0]?.[1] ?? [];
    expect(features[0]?.geometry).toEqual({ type: 'Point', coordinates: [-73.9654, 40.7829] });
    expect(features[0]?.properties).toEqual({ name: 'Central Park' }); // lat/lng excluded
  });

  it('parses a CSV with latitude/longitude column names', async () => {
    const csv = 'id,latitude,longitude\n1,51.5074,-0.1278\n2,48.8566,2.3522';
    const path = writeTmpCSV(csv);
    const result = await importCSV(path, 'map-uuid', 'Cities', 'job-uuid');

    expect(result.featureCount).toBe(2);
    const features = vi.mocked(insertFeatures).mock.calls[0]?.[1] ?? [];
    expect(features[1]?.geometry).toEqual({ type: 'Point', coordinates: [2.3522, 48.8566] });
  });

  it('parses a CSV with y/x column names', async () => {
    const csv = 'label,y,x\nA,35.6762,139.6503';
    const path = writeTmpCSV(csv);
    const result = await importCSV(path, 'map-uuid', 'Tokyo', 'job-uuid');

    expect(result.featureCount).toBe(1);
  });

  it('throws when no coordinate columns AND no address column can be detected', async () => {
    const csv = 'city,population\nLondon,9000000\nParis,2100000';
    const path = writeTmpCSV(csv);
    // Neither lat/lng nor address column present → error
    await expect(importCSV(path, 'map-uuid', 'Cities', 'job-uuid')).rejects.toThrow(
      'Could not detect latitude/longitude columns'
    );
  });

  it('throws when the CSV is empty (zero data rows)', async () => {
    const csv = 'lat,lng\n'; // headers only
    const path = writeTmpCSV(csv);
    await expect(importCSV(path, 'map-uuid', 'Empty', 'job-uuid')).rejects.toThrow('empty');
  });

  it('skips rows with invalid coordinate values', async () => {
    // Row 2 has out-of-range lat (91), row 3 has non-numeric lng
    const csv = 'name,lat,lng\nGood,40.7,-74.0\nBadLat,91.0,-74.0\nBadLng,40.7,abc';
    const path = writeTmpCSV(csv);
    const result = await importCSV(path, 'map-uuid', 'Mixed', 'job-uuid');

    expect(result.featureCount).toBe(1);
    const features = vi.mocked(insertFeatures).mock.calls[0]?.[1] ?? [];
    expect(features).toHaveLength(1);
    expect(features[0]?.properties).toEqual({ name: 'Good' });
  });

  it('throws when all rows have invalid coordinates', async () => {
    const csv = 'lat,lng\n999,999\n-999,-999';
    const path = writeTmpCSV(csv);
    await expect(importCSV(path, 'map-uuid', 'AllBad', 'job-uuid')).rejects.toThrow(
      'No valid coordinate rows'
    );
  });

  it('throws when the layer insert returns nothing', async () => {
    vi.mocked(db.insert).mockImplementation(() => ({
      values: vi.fn().mockReturnValue({
        returning: vi.fn().mockResolvedValue([]),
      }),
    }) as unknown as ReturnType<typeof db.insert>);

    const csv = 'lat,lng\n40.7,-74.0';
    const path = writeTmpCSV(csv);
    await expect(importCSV(path, 'map-uuid', 'Fail', 'job-uuid')).rejects.toThrow(
      'Failed to create layer'
    );
  });

  // ── Geocoding fallback (address column) ────────────────────────────────────

  it('geocodes rows when address column is present and no lat/lng columns exist', async () => {
    vi.mocked(geocodeBatch).mockResolvedValue([
      { lat: 48.8566, lng: 2.3522, displayName: 'Paris, France' },
      { lat: 51.5074, lng: -0.1278, displayName: 'London, UK' },
    ]);

    const csv = 'name,address\nParis,Paris France\nLondon,London UK';
    const path = writeTmpCSV(csv);
    const result = await importCSV(path, 'map-uuid', 'Cities', 'job-uuid');

    expect(geocodeBatch).toHaveBeenCalledOnce();
    expect(result.featureCount).toBe(2);

    const features = vi.mocked(insertFeatures).mock.calls[0]?.[1] ?? [];
    expect(features[0]?.geometry).toEqual({ type: 'Point', coordinates: [2.3522, 48.8566] });
    // Address column preserved in properties
    expect(features[0]?.properties?.['address']).toBe('Paris France');
  });

  it('skips rows where geocoding returns null', async () => {
    vi.mocked(geocodeBatch).mockResolvedValue([
      { lat: 48.8566, lng: 2.3522, displayName: 'Paris' },
      null, // geocoding failed
    ]);

    const csv = 'name,address\nGood,Paris France\nBad,Unknown Place 99999';
    const path = writeTmpCSV(csv);
    const result = await importCSV(path, 'map-uuid', 'Mixed', 'job-uuid');

    expect(result.featureCount).toBe(1);
    const features = vi.mocked(insertFeatures).mock.calls[0]?.[1] ?? [];
    expect(features[0]?.properties?.['name']).toBe('Good');
  });

  it('throws when all geocoding results are null', async () => {
    vi.mocked(geocodeBatch).mockResolvedValue([null, null]);

    const csv = 'address\nNowhere 1\nNowhere 2';
    const path = writeTmpCSV(csv);
    await expect(importCSV(path, 'map-uuid', 'Fail', 'job-uuid')).rejects.toThrow(
      'Geocoding failed for all'
    );
  });

  it('throws when the address column is present but all rows are blank', async () => {
    const csv = 'name,address\nA,\nB,';
    const path = writeTmpCSV(csv);
    await expect(importCSV(path, 'map-uuid', 'Blank', 'job-uuid')).rejects.toThrow(
      'empty in all rows'
    );
    expect(geocodeBatch).not.toHaveBeenCalled();
  });
});
