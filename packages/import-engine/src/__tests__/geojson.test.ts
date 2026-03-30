import { describe, it, expect, afterEach } from 'vitest';
import { writeFile, mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseGeoJSON } from '../geojson.js';

describe('parseGeoJSON', () => {
  let tmpDir: string;

  async function setup() {
    tmpDir = await mkdtemp(join(tmpdir(), 'geojson-test-'));
  }

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('parses a FeatureCollection', async () => {
    await setup();
    const data = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10, 20] },
          properties: { name: 'A' },
        },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [30, 40] },
          properties: { name: 'B' },
        },
      ],
    };
    const filePath = join(tmpDir, 'test.geojson');
    await writeFile(filePath, JSON.stringify(data));

    const result = await parseGeoJSON(filePath);
    expect(result).toHaveLength(2);
    expect(result[0]?.geometry.type).toBe('Point');
    expect(result[0]?.properties).toEqual({ name: 'A' });
    expect(result[1]?.geometry.type).toBe('Point');
  });

  it('parses a single Feature', async () => {
    await setup();
    const data = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      properties: { route: 'test' },
    };
    const filePath = join(tmpDir, 'single.geojson');
    await writeFile(filePath, JSON.stringify(data));

    const result = await parseGeoJSON(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.geometry.type).toBe('LineString');
    expect(result[0]?.properties).toEqual({ route: 'test' });
  });

  it('parses a bare Geometry', async () => {
    await setup();
    const data = { type: 'Point', coordinates: [5, 10] };
    const filePath = join(tmpDir, 'bare.geojson');
    await writeFile(filePath, JSON.stringify(data));

    const result = await parseGeoJSON(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.geometry.type).toBe('Point');
    expect(result[0]?.properties).toEqual({});
  });

  it('filters out features with null geometry', async () => {
    await setup();
    const data = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: null, properties: { name: 'null-geom' } },
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [1, 2] },
          properties: { name: 'valid' },
        },
      ],
    };
    const filePath = join(tmpDir, 'nullgeom.geojson');
    await writeFile(filePath, JSON.stringify(data));

    const result = await parseGeoJSON(filePath);
    expect(result).toHaveLength(1);
    expect(result[0]?.properties).toEqual({ name: 'valid' });
  });

  it('normalizes null properties to empty object', async () => {
    await setup();
    const data = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: null,
    };
    const filePath = join(tmpDir, 'nullprops.geojson');
    await writeFile(filePath, JSON.stringify(data));

    const result = await parseGeoJSON(filePath);
    expect(result[0]?.properties).toEqual({});
  });

  it('throws on empty FeatureCollection', async () => {
    await setup();
    const data = { type: 'FeatureCollection', features: [] };
    const filePath = join(tmpDir, 'empty.geojson');
    await writeFile(filePath, JSON.stringify(data));

    await expect(parseGeoJSON(filePath)).rejects.toThrow(
      'GeoJSON contains no features'
    );
  });

  it('throws on invalid JSON', async () => {
    await setup();
    const filePath = join(tmpDir, 'invalid.geojson');
    await writeFile(filePath, '{not valid json}}}');

    await expect(parseGeoJSON(filePath)).rejects.toThrow('Invalid JSON');
  });

  it('throws on unrecognized structure', async () => {
    await setup();
    const filePath = join(tmpDir, 'weird.geojson');
    await writeFile(filePath, JSON.stringify({ type: 'Topology', objects: {} }));

    await expect(parseGeoJSON(filePath)).rejects.toThrow();
  });
});
