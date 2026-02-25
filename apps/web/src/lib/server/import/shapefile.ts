import { readFile } from 'fs/promises';
import { extname } from 'path';
import type { Geometry } from '@felt-like-it/shared-types';
import { createLayerAndInsertFeatures } from './shared.js';
import type { ImportResult } from './shared.js';

type ShpFeature = {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
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
async function parseShapefile(filePath: string): Promise<ShpFeature[]> {
  const { default: shpjs } = await import('shpjs');

  const ext = extname(filePath).toLowerCase();
  const buf = await readFile(filePath);

  // shpjs accepts ArrayBuffer
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;

  let result: ShpFeatureCollection | ShpFeatureCollection[];

  if (ext === '.zip') {
    result = await shpjs(arrayBuffer) as ShpFeatureCollection | ShpFeatureCollection[];
  } else if (ext === '.shp') {
    // Raw .shp without .dbf — geometry only, empty properties
    const geometries = await shpjs.parseShp(arrayBuffer);
    return geometries.map((geom) => ({
      type: 'Feature' as const,
      geometry: geom as { type: string; coordinates: unknown },
      properties: {},
    }));
  } else {
    throw new Error(`Unsupported Shapefile extension: ${ext}`);
  }

  // Normalize: shpjs may return a single FeatureCollection or an array
  const collections = Array.isArray(result) ? result : [result];
  return collections.flatMap((fc) => fc.features ?? []);
}

/**
 * Import a Shapefile (.shp or .zip) into a new layer.
 * Accepts .zip containing .shp + .dbf (standard distribution format).
 */
export async function importShapefile(
  filePath: string,
  mapId: string,
  layerName: string,
  jobId: string
): Promise<ImportResult> {
  const rawFeatures = await parseShapefile(filePath);

  if (rawFeatures.length === 0) {
    throw new Error('Shapefile contains no features');
  }

  // Normalize into our standard feature shape
  const featureList = rawFeatures
    .filter((f) => f.geometry !== null && f.geometry !== undefined)
    .map((f) => ({
      geometry: f.geometry as Geometry,
      properties: f.properties ?? {},
    }));

  if (featureList.length === 0) {
    throw new Error('Shapefile contains no features with valid geometry');
  }

  return createLayerAndInsertFeatures({
    mapId,
    jobId,
    layerName,
    features: featureList,
  });
}
