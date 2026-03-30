import { readFile } from 'fs/promises';
import { extname } from 'path';
import type { Geometry } from '@felt-like-it/shared-types';
import type { ParsedFeature } from './types.js';

type ShpFeature = {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
};

type ShpFeatureCollection = {
  type: 'FeatureCollection';
  features: ShpFeature[];
};

/**
 * Parse a Shapefile (.shp or .zip) into GeoJSON features.
 * .zip must contain at minimum: .shp + .dbf (+ optionally .prj for CRS).
 * Uses shpjs which handles both raw .shp and .zip containing .shp/.dbf/.prj.
 */
export async function parseShapefile(filePath: string): Promise<ParsedFeature[]> {
  const { default: shpjs } = await import('shpjs');

  const ext = extname(filePath).toLowerCase();
  const buf = await readFile(filePath);

  // shpjs accepts ArrayBuffer
  const arrayBuffer = buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength
  ) as ArrayBuffer;

  let rawFeatures: ShpFeature[];

  if (ext === '.zip') {
    const result = (await shpjs(arrayBuffer)) as
      | ShpFeatureCollection
      | ShpFeatureCollection[];

    // Normalize: shpjs may return a single FeatureCollection or an array
    const collections = Array.isArray(result) ? result : [result];
    rawFeatures = collections.flatMap((fc) => fc.features ?? []);
  } else if (ext === '.shp') {
    // Raw .shp without .dbf — geometry only, empty properties
    const geometries = await shpjs.parseShp(arrayBuffer);
    rawFeatures = geometries.map((geom: { type: string; coordinates: unknown }) => ({
      type: 'Feature' as const,
      geometry: geom as { type: string; coordinates: unknown },
      properties: {},
    }));
  } else {
    throw new Error(`Unsupported Shapefile extension: ${ext}`);
  }

  // Filter out null geometries and normalize properties
  const features = rawFeatures
    .filter((f) => f.geometry !== null && f.geometry !== undefined)
    .map((f) => ({
      geometry: f.geometry as Geometry,
      properties: (f.properties ?? {}) as Record<string, unknown>,
    }));

  if (features.length === 0) {
    throw new Error('Shapefile contains no features with valid geometry');
  }

  return features;
}
