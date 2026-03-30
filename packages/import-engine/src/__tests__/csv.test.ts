import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseCSV, csvRowsToFeatures } from '../csv.js';

describe('parseCSV', () => {
  let tmpDir: string;

  async function setup() {
    tmpDir = await mkdtemp(join(tmpdir(), 'csv-test-'));
  }

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('parses CSV with headers and rows', async () => {
    await setup();
    const csv = 'name,latitude,longitude\nPark,40.7,-74.0\nBeach,34.0,-118.2\n';
    const filePath = join(tmpDir, 'test.csv');
    await writeFile(filePath, csv);

    const result = await parseCSV(filePath);
    expect(result.headers).toEqual(['name', 'latitude', 'longitude']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({
      name: 'Park',
      latitude: '40.7',
      longitude: '-74.0',
    });
  });

  it('skips empty lines', async () => {
    await setup();
    const csv = 'a,b\n1,2\n\n3,4\n\n';
    const filePath = join(tmpDir, 'sparse.csv');
    await writeFile(filePath, csv);

    const result = await parseCSV(filePath);
    expect(result.rows).toHaveLength(2);
  });
});

describe('csvRowsToFeatures', () => {
  it('converts rows with lat/lng columns to Point features', () => {
    const headers = ['name', 'lat', 'lng'];
    const rows = [
      { name: 'A', lat: '40.7128', lng: '-74.0060' },
      { name: 'B', lat: '34.0522', lng: '-118.2437' },
    ];

    const features = csvRowsToFeatures(headers, rows);
    expect(features).toHaveLength(2);
    expect(features[0]?.geometry).toEqual({
      type: 'Point',
      coordinates: [-74.006, 40.7128],
    });
    // lat/lng columns should be excluded from properties
    expect(features[0]?.properties).toEqual({ name: 'A' });
  });

  it('skips rows with invalid coordinates', () => {
    const headers = ['name', 'lat', 'lng'];
    const rows = [
      { name: 'valid', lat: '40.7', lng: '-74.0' },
      { name: 'bad-lat', lat: '999', lng: '-74.0' },
      { name: 'nan', lat: 'abc', lng: '-74.0' },
    ];

    const features = csvRowsToFeatures(headers, rows);
    expect(features).toHaveLength(1);
    expect(features[0]?.properties).toEqual({ name: 'valid' });
  });

  it('throws when no coordinate columns detected', () => {
    const headers = ['name', 'value', 'category'];
    const rows = [{ name: 'A', value: '1', category: 'X' }];

    expect(() => csvRowsToFeatures(headers, rows)).toThrow(
      'Could not detect latitude/longitude columns'
    );
  });

  it('throws when all coordinate rows are invalid', () => {
    const headers = ['name', 'latitude', 'longitude'];
    const rows = [
      { name: 'A', latitude: 'not-a-number', longitude: 'also-not' },
    ];

    expect(() => csvRowsToFeatures(headers, rows)).toThrow(
      'No valid coordinate rows found'
    );
  });

  it('handles latitude/longitude header variants', () => {
    const headers = ['id', 'Latitude', 'Longitude'];
    const rows = [{ id: '1', Latitude: '51.5', Longitude: '-0.1' }];

    const features = csvRowsToFeatures(headers, rows);
    expect(features).toHaveLength(1);
    expect(features[0]?.geometry.coordinates).toEqual([-0.1, 51.5]);
  });
});
