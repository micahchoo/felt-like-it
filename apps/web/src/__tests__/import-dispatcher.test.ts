// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    insert: vi.fn(),
    update: vi.fn(),
    select: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  layers: {},
  importJobs: {},
  maps: {},
  features: {},
}));

vi.mock('$lib/server/geo/queries.js', () => ({
  insertFeatures: vi.fn().mockResolvedValue(undefined),
  getLayerBbox: vi.fn().mockResolvedValue(null),
  deleteLayer: vi.fn().mockResolvedValue(undefined),
  getImportJobLayerId: vi.fn().mockResolvedValue(null),
}));

// Mock format-specific importers so we don't run real file I/O
vi.mock('../lib/server/import/geojson.js', () => ({
  importGeoJSON: vi.fn().mockResolvedValue({ layerId: 'new-layer', featureCount: 5, bbox: null }),
}));

vi.mock('../lib/server/import/csv.js', () => ({
  importCSV: vi.fn().mockResolvedValue({ layerId: 'new-layer', featureCount: 3, bbox: null }),
}));

vi.mock('../lib/server/import/shapefile.js', () => ({
  importShapefile: vi.fn().mockResolvedValue({ layerId: 'new-layer', featureCount: 10, bbox: null }),
}));

vi.mock('../lib/server/import/xmlgeo.js', () => ({
  importXmlGeo: vi.fn().mockResolvedValue({ layerId: 'new-layer', featureCount: 7, bbox: null }),
}));

vi.mock('../lib/server/import/geopackage.js', () => ({
  importGeoPackage: vi.fn().mockResolvedValue({ layerId: 'new-layer', featureCount: 4, bbox: null }),
}));

// ─── Subject imports ──────────────────────────────────────────────────────────

import { detectFormat, importFile } from '../lib/server/import/index.js';
import { importGeoJSON } from '../lib/server/import/geojson.js';
import { importCSV } from '../lib/server/import/csv.js';
import { importShapefile } from '../lib/server/import/shapefile.js';
import { importXmlGeo } from '../lib/server/import/xmlgeo.js';
import { importGeoPackage } from '../lib/server/import/geopackage.js';
import { deleteLayer, getImportJobLayerId } from '$lib/server/geo/queries.js';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('detectFormat', () => {
  it('detects .geojson as geojson', () => {
    expect(detectFormat('data.geojson')).toBe('geojson');
  });

  it('detects .json as geojson', () => {
    expect(detectFormat('data.json')).toBe('geojson');
  });

  it('detects .csv', () => {
    expect(detectFormat('points.csv')).toBe('csv');
  });

  it('detects .zip as shapefile', () => {
    expect(detectFormat('parks.zip')).toBe('shapefile');
  });

  it('detects .shp as shapefile', () => {
    expect(detectFormat('parks.shp')).toBe('shapefile');
  });

  it('detects .kml', () => {
    expect(detectFormat('route.kml')).toBe('kml');
  });

  it('detects .gpx', () => {
    expect(detectFormat('track.gpx')).toBe('gpx');
  });

  it('detects .gpkg as geopackage', () => {
    expect(detectFormat('data.gpkg')).toBe('geopackage');
  });

  it('returns null for unknown extensions', () => {
    expect(detectFormat('file.xlsx')).toBeNull();
    expect(detectFormat('file.kmz')).toBeNull();
    expect(detectFormat('noextension')).toBeNull();
  });

  it('is case-insensitive for extension detection', () => {
    expect(detectFormat('data.GEOJSON')).toBe('geojson');
    expect(detectFormat('data.CSV')).toBe('csv');
    expect(detectFormat('data.ZIP')).toBe('shapefile');
  });
});

describe('importFile dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getImportJobLayerId).mockResolvedValue(null);
    vi.mocked(importGeoJSON).mockResolvedValue({ layerId: 'new-layer', featureCount: 5, bbox: null });
    vi.mocked(importCSV).mockResolvedValue({ layerId: 'new-layer', featureCount: 3, bbox: null });
    vi.mocked(importShapefile).mockResolvedValue({ layerId: 'new-layer', featureCount: 10, bbox: null });
    vi.mocked(importXmlGeo).mockResolvedValue({ layerId: 'new-layer', featureCount: 7, bbox: null });
    vi.mocked(importGeoPackage).mockResolvedValue({ layerId: 'new-layer', featureCount: 4, bbox: null });
  });

  it('dispatches .geojson to importGeoJSON', async () => {
    await importFile('/tmp/test.geojson', 'data.geojson', 'map-id', 'Layer', 'job-id');
    expect(importGeoJSON).toHaveBeenCalledWith('/tmp/test.geojson', 'map-id', 'Layer', 'job-id');
  });

  it('dispatches .csv to importCSV', async () => {
    await importFile('/tmp/points.csv', 'points.csv', 'map-id', 'Points', 'job-id');
    expect(importCSV).toHaveBeenCalledWith('/tmp/points.csv', 'map-id', 'Points', 'job-id');
  });

  it('dispatches .zip to importShapefile', async () => {
    await importFile('/tmp/parks.zip', 'parks.zip', 'map-id', 'Parks', 'job-id');
    expect(importShapefile).toHaveBeenCalledWith('/tmp/parks.zip', 'map-id', 'Parks', 'job-id');
  });

  it('dispatches .shp to importShapefile', async () => {
    await importFile('/tmp/roads.shp', 'roads.shp', 'map-id', 'Roads', 'job-id');
    expect(importShapefile).toHaveBeenCalledWith('/tmp/roads.shp', 'map-id', 'Roads', 'job-id');
  });

  it('dispatches .kml to importXmlGeo with format=kml', async () => {
    await importFile('/tmp/route.kml', 'route.kml', 'map-id', 'Route', 'job-id');
    expect(importXmlGeo).toHaveBeenCalledWith('/tmp/route.kml', 'map-id', 'Route', 'job-id', 'kml');
  });

  it('dispatches .gpx to importXmlGeo with format=gpx', async () => {
    await importFile('/tmp/track.gpx', 'track.gpx', 'map-id', 'Track', 'job-id');
    expect(importXmlGeo).toHaveBeenCalledWith('/tmp/track.gpx', 'map-id', 'Track', 'job-id', 'gpx');
  });

  it('dispatches .gpkg to importGeoPackage', async () => {
    await importFile('/tmp/data.gpkg', 'data.gpkg', 'map-id', 'Layer', 'job-id');
    expect(importGeoPackage).toHaveBeenCalledWith('/tmp/data.gpkg', 'map-id', 'Layer', 'job-id');
  });

  it('throws for unsupported format', async () => {
    await expect(
      importFile('/tmp/data.xlsx', 'data.xlsx', 'map-id', 'Layer', 'job-id')
    ).rejects.toThrow('Unsupported file format');
  });

  it('error message for unsupported format lists supported formats including .gpkg', async () => {
    await expect(
      importFile('/tmp/data.xlsx', 'data.xlsx', 'map-id', 'Layer', 'job-id')
    ).rejects.toThrow('.gpkg');
  });
});

describe('importFile retry cleanup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(importGeoJSON).mockResolvedValue({ layerId: 'new-layer', featureCount: 5, bbox: null });
  });

  it('does not call deleteLayer when no previous layer exists', async () => {
    vi.mocked(getImportJobLayerId).mockResolvedValue(null);
    await importFile('/tmp/test.geojson', 'data.geojson', 'map-id', 'Layer', 'job-id');
    expect(deleteLayer).not.toHaveBeenCalled();
  });

  it('deletes existing layer before retry when layer_id exists in import_jobs', async () => {
    vi.mocked(getImportJobLayerId).mockResolvedValue('old-partial-layer-id');
    await importFile('/tmp/test.geojson', 'data.geojson', 'map-id', 'Layer', 'job-id');
    expect(deleteLayer).toHaveBeenCalledWith('old-partial-layer-id');
  });

  it('cleans up before dispatching to the format-specific importer', async () => {
    const callOrder: string[] = [];
    vi.mocked(getImportJobLayerId).mockResolvedValue('old-layer');
    vi.mocked(deleteLayer).mockImplementation(async () => { callOrder.push('delete'); });
    vi.mocked(importGeoJSON).mockImplementation(async () => { callOrder.push('import'); return { layerId: 'new', featureCount: 1, bbox: null }; });

    await importFile('/tmp/test.geojson', 'data.geojson', 'map-id', 'Layer', 'job-id');
    expect(callOrder).toEqual(['delete', 'import']);
  });
});
