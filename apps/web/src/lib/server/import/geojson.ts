import { validateGeoJSON, detectLayerType, generateAutoStyle } from '@felt-like-it/geo-engine';
import { db, layers, importJobs } from '../db/index.js';
import { insertFeatures, getLayerBbox } from '../geo/queries.js';
import { eq } from 'drizzle-orm';
import { readFile } from 'fs/promises';

export interface ImportResult {
  layerId: string;
  featureCount: number;
  bbox: [number, number, number, number] | null;
}

/**
 * Import a GeoJSON file into a new layer in the given map.
 * Updates job progress during processing.
 */
export async function importGeoJSON(
  filePath: string,
  mapId: string,
  layerName: string,
  jobId: string
): Promise<ImportResult> {
  // Read file
  const raw = await readFile(filePath, 'utf-8');
  let geojson: unknown;

  try {
    geojson = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON in file`);
  }

  // Validate
  const validation = validateGeoJSON(geojson);
  if (!validation.valid) {
    throw new Error(`Invalid GeoJSON: ${validation.errors.slice(0, 3).join(', ')}`);
  }

  const data = geojson as {
    type: string;
    features?: Array<{ geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> | null }>;
  };

  // Normalize to FeatureCollection
  let featureList: Array<{
    geometry: { type: string; coordinates: unknown };
    properties: Record<string, unknown>;
  }>;

  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    featureList = data.features.map((f) => ({
      geometry: f.geometry as { type: string; coordinates: unknown },
      properties: f.properties ?? {},
    }));
  } else if (data.type === 'Feature') {
    const f = data as unknown as {
      geometry: { type: string; coordinates: unknown };
      properties: Record<string, unknown> | null;
    };
    featureList = [{ geometry: f.geometry, properties: f.properties ?? {} }];
  } else {
    // Single geometry
    featureList = [{ geometry: data as unknown as { type: string; coordinates: unknown }, properties: {} }];
  }

  if (featureList.length === 0) {
    throw new Error('GeoJSON contains no features');
  }

  // Detect layer type and auto-style
  const layerType = detectLayerType(
    featureList.map((f) => ({ geometry: { type: f.geometry.type } }))
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

  // Update job with layer ID
  await db
    .update(importJobs)
    .set({ layerId: layer.id, progress: 10, status: 'processing' })
    .where(eq(importJobs.id, jobId));

  // Insert features in batches
  const BATCH_SIZE = 500;
  let inserted = 0;

  for (let i = 0; i < featureList.length; i += BATCH_SIZE) {
    const batch = featureList.slice(i, i + BATCH_SIZE);
    await insertFeatures(
      layer.id,
      batch.map((f) => ({
        geometry: f.geometry as Record<string, unknown>,
        properties: f.properties,
      }))
    );
    inserted += batch.length;

    // Update progress (10–90%)
    const progress = Math.round(10 + (inserted / featureList.length) * 80);
    await db
      .update(importJobs)
      .set({ progress })
      .where(eq(importJobs.id, jobId));
  }

  const bbox = await getLayerBbox(layer.id);

  return {
    layerId: layer.id,
    featureCount: inserted,
    bbox,
  };
}
