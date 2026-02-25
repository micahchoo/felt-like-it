import { validateGeoJSON } from '@felt-like-it/geo-engine';
import type { Geometry } from '@felt-like-it/shared-types';
import { readFile } from 'fs/promises';
import { createLayerAndInsertFeatures } from './shared.js';
import type { ImportResult } from './shared.js';

export type { ImportResult } from './shared.js';

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

  return createLayerAndInsertFeatures({
    mapId,
    jobId,
    layerName,
    features: featureList.map((f) => ({
      geometry: f.geometry as Geometry,
      properties: f.properties,
    })),
  });
}
