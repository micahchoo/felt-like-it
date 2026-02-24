import { readFile } from 'fs/promises';
import { extname } from 'path';
import { detectLayerType, generateAutoStyle } from '@felt-like-it/geo-engine';
import { db, layers, importJobs } from '../db/index.js';
import { insertFeatures, getLayerBbox } from '../geo/queries.js';
import { eq } from 'drizzle-orm';
import type { ImportResult } from './geojson.js';

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
      geometry: f.geometry as Record<string, unknown>,
      properties: f.properties ?? {},
    }));

  if (featureList.length === 0) {
    throw new Error('Shapefile contains no features with valid geometry');
  }

  // Detect layer type from the dominant geometry type
  const layerType = detectLayerType(
    featureList.map((f) => ({ geometry: { type: String(f.geometry['type'] ?? 'Point') } }))
  );

  const autoStyle = generateAutoStyle(layerType, featureList.map((f) => ({ properties: f.properties })));

  // Create layer
  const [layer] = await db
    .insert(layers)
    .values({
      mapId,
      name: layerName,
      type: layerType,
      style: autoStyle,
      sourceFileName: layerName,
    })
    .returning();

  if (!layer) throw new Error('Failed to create layer');

  await db
    .update(importJobs)
    .set({ layerId: layer.id, progress: 10, status: 'processing' })
    .where(eq(importJobs.id, jobId));

  // Insert features in batches of 500 (one multi-row INSERT per batch)
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < featureList.length; i += BATCH_SIZE) {
    const batch = featureList.slice(i, i + BATCH_SIZE);
    await insertFeatures(layer.id, batch);
    inserted += batch.length;

    const progress = Math.round(10 + (inserted / featureList.length) * 80);
    await db.update(importJobs).set({ progress }).where(eq(importJobs.id, jobId));
  }

  const bbox = await getLayerBbox(layer.id);

  return {
    layerId: layer.id,
    featureCount: inserted,
    bbox,
  };
}
