import { parseGeoJSON } from '@felt-like-it/import-engine';
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
  const features = await parseGeoJSON(filePath);

  return createLayerAndInsertFeatures({
    mapId,
    jobId,
    layerName,
    features,
  });
}
