import { describe, it, expect, vi } from 'vitest';

// Mock shpjs since it processes binary formats
vi.mock('shpjs', () => {
  const mockShpjs = async (arrayBuffer: ArrayBuffer) => {
    // Simulate shpjs returning a FeatureCollection from a .zip
    void arrayBuffer;
    return {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [10, 20] },
          properties: { name: 'from-zip' },
        },
        {
          type: 'Feature',
          geometry: null,
          properties: { name: 'null-geom' },
        },
      ],
    };
  };

  mockShpjs.parseShp = async (arrayBuffer: ArrayBuffer) => {
    void arrayBuffer;
    return [
      { type: 'Point', coordinates: [30, 40] },
      { type: 'Point', coordinates: [50, 60] },
    ];
  };

  return { default: mockShpjs };
});

// Must import after vi.mock
const { parseShapefile } = await import('../shapefile.js');

// Mock fs/promises to avoid needing real binary files
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>();
  return {
    ...actual,
    readFile: vi.fn(async (filePath: string) => {
      void filePath;
      // Return a minimal Buffer (shpjs mock ignores content)
      return Buffer.from([0, 1, 2, 3]);
    }),
  };
});

describe('parseShapefile', () => {
  it('parses a .zip shapefile and filters null geometries', async () => {
    const features = await parseShapefile('/fake/test.zip');
    expect(features).toHaveLength(1);
    expect(features[0]?.geometry.type).toBe('Point');
    expect(features[0]?.properties).toEqual({ name: 'from-zip' });
  });

  it('parses a raw .shp file with empty properties', async () => {
    const features = await parseShapefile('/fake/test.shp');
    expect(features).toHaveLength(2);
    expect(features[0]?.geometry.type).toBe('Point');
    expect(features[0]?.properties).toEqual({});
  });

  it('throws on unsupported extension', async () => {
    await expect(parseShapefile('/fake/test.dbf')).rejects.toThrow(
      'Unsupported Shapefile extension'
    );
  });
});
