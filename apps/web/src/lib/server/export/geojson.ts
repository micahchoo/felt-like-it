import { getExportData, toFeatureCollection } from './shared.js';

export interface ExportOptions {
  layerId: string;
  userId: string;
}

/**
 * Export a layer as a GeoJSON FeatureCollection string.
 * Verifies viewer+ access (owner or collaborator).
 */
export async function exportLayerAsGeoJSON(options: ExportOptions): Promise<string> {
  const data = await getExportData(options.layerId, options.userId);
  const fc = toFeatureCollection(data);
  return JSON.stringify(fc, null, 2);
}
