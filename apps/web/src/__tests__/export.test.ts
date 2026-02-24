// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExportData } from '$lib/server/export/shared.js';

// Mock SvelteKit error
vi.mock('@sveltejs/kit', () => ({
  error: (status: number, message: string) => {
    throw Object.assign(new Error(message), { status });
  },
}));

const MOCK_DATA: ExportData = {
  layerId: '00000000-0000-0000-0000-000000000001',
  layerName: 'Test Layer',
  layerType: 'point',
  features: [
    {
      id: 'f1',
      layerId: '00000000-0000-0000-0000-000000000001',
      geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
      properties: { name: 'Golden Gate Bridge', city: 'San Francisco' },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    {
      id: 'f2',
      layerId: '00000000-0000-0000-0000-000000000001',
      geometry: { type: 'Point', coordinates: [-118.2, 34.0] },
      properties: { name: 'LA City Hall', city: 'Los Angeles' },
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
};

const MIXED_DATA: ExportData = {
  ...MOCK_DATA,
  layerType: 'mixed',
};

beforeEach(() => {
  vi.resetAllMocks();
});

describe('toFeatureCollection', () => {
  it('builds a valid GeoJSON FeatureCollection', async () => {
    const { toFeatureCollection } = await import('$lib/server/export/shared.js');
    const fc = toFeatureCollection(MOCK_DATA);
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features).toHaveLength(2);
    expect(fc.features[0]?.type).toBe('Feature');
    expect(fc.features[0]?.geometry).toEqual({ type: 'Point', coordinates: [-122.4, 37.8] });
    expect(fc.features[0]?.properties).toEqual({ name: 'Golden Gate Bridge', city: 'San Francisco' });
  });
});

describe('GeoPackage export', () => {
  it('produces a buffer starting with SQLite magic', async () => {
    const { exportAsGeoPackage } = await import('$lib/server/export/geopackage.js');
    const buf = await exportAsGeoPackage(MOCK_DATA);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
    // SQLite files start with "SQLite format 3\0"
    const magic = buf.subarray(0, 16).toString('ascii');
    expect(magic).toContain('SQLite format 3');
  });

  it('contains the correct number of features when reopened', async () => {
    const { exportAsGeoPackage } = await import('$lib/server/export/geopackage.js');
    const buf = await exportAsGeoPackage(MOCK_DATA);

    const initSqlJs = (await import('sql.js')).default;
    const SQL = await initSqlJs();
    const db = new SQL.Database(new Uint8Array(buf));

    const result = db.exec('SELECT COUNT(*) FROM features');
    const count = (result[0]?.values[0] as [number])?.[0];
    expect(count).toBe(2);

    const contents = db.exec("SELECT table_name FROM gpkg_contents WHERE data_type = 'features'");
    expect(contents[0]?.values).toHaveLength(1);

    db.close();
  });
});

describe('Shapefile export', () => {
  it('produces a zip buffer for point data', async () => {
    const { exportAsShapefile } = await import('$lib/server/export/shapefile.js');
    const buf = await exportAsShapefile(MOCK_DATA);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
    // ZIP files start with PK (0x50 0x4B)
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4b);
  });

  it('rejects mixed geometry type', async () => {
    const { exportAsShapefile } = await import('$lib/server/export/shapefile.js');
    await expect(exportAsShapefile(MIXED_DATA)).rejects.toThrow(/single geometry type/);
  });
});

describe('PDF export', () => {
  it('produces a buffer starting with %PDF', async () => {
    const { exportAsPdf } = await import('$lib/server/export/pdf.js');
    const buf = await exportAsPdf({ data: MOCK_DATA, title: 'Test Map' });
    expect(buf).toBeInstanceOf(Buffer);
    const magic = buf.subarray(0, 5).toString('ascii');
    expect(magic).toBe('%PDF-');
  });

  it('includes screenshot when provided', async () => {
    const { exportAsPdf } = await import('$lib/server/export/pdf.js');
    // 1x1 red PNG as base64
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
    const buf = await exportAsPdf({ data: MOCK_DATA, screenshot: tinyPng });
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);
  });
});
