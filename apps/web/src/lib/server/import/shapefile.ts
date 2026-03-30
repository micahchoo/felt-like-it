import { parseShapefile } from '@felt-like-it/import-engine';
import { createLayerAndInsertFeatures } from './shared.js';
import type { ImportResult } from './shared.js';

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
  const features = await parseShapefile(filePath);

  return createLayerAndInsertFeatures({
    mapId,
    jobId,
    layerName,
    features,
  });
}
