import { extname } from 'path';
import { importGeoJSON } from './geojson.js';
import { importCSV } from './csv.js';
import { importShapefile } from './shapefile.js';
import { importXmlGeo } from './xmlgeo.js';
import { importGeoPackage } from './geopackage.js';
import { deleteLayer, getImportJobLayerId } from '../geo/queries.js';
import type { ImportResult } from './shared.js';

export type { ImportResult } from './shared.js';

export type SupportedFormat = 'geojson' | 'csv' | 'shapefile' | 'kml' | 'gpx' | 'geopackage';

/** Detect the format of a file from its extension */
export function detectFormat(fileName: string): SupportedFormat | null {
  const ext = extname(fileName).toLowerCase();
  switch (ext) {
    case '.geojson':
    case '.json':
      return 'geojson';
    case '.csv':
      return 'csv';
    case '.zip':
    case '.shp':
      return 'shapefile';
    case '.kml':
      return 'kml';
    case '.gpx':
      return 'gpx';
    case '.gpkg':
      return 'geopackage';
    default:
      return null;
  }
}

/**
 * Clean up any partial state from a previous (failed) attempt.
 * BullMQ retries with the same jobId — if a layer was created but features
 * weren't fully inserted, we delete it so the importer starts fresh.
 */
async function cleanupPreviousAttempt(jobId: string): Promise<void> {
  const existingLayerId = await getImportJobLayerId(jobId);
  if (existingLayerId) {
    await deleteLayer(existingLayerId);
  }
}

/**
 * Dispatch to the correct importer based on file format.
 * Cleans up any partial state from previous BullMQ retry attempts first.
 */
export async function importFile(
  filePath: string,
  fileName: string,
  mapId: string,
  layerName: string,
  jobId: string
): Promise<ImportResult> {
  // Guard against partial state from a previous failed attempt
  await cleanupPreviousAttempt(jobId);

  const format = detectFormat(fileName);

  switch (format) {
    case 'geojson':
      return importGeoJSON(filePath, mapId, layerName, jobId);
    case 'csv':
      return importCSV(filePath, mapId, layerName, jobId);
    case 'shapefile':
      return importShapefile(filePath, mapId, layerName, jobId);
    case 'kml':
      return importXmlGeo(filePath, mapId, layerName, jobId, 'kml');
    case 'gpx':
      return importXmlGeo(filePath, mapId, layerName, jobId, 'gpx');
    case 'geopackage':
      return importGeoPackage(filePath, mapId, layerName, jobId);
    default:
      throw new Error(
        `Unsupported file format: ${extname(fileName)}. ` +
        'Supported formats: .geojson, .json, .csv, .zip (Shapefile), .shp, .kml, .gpx, .gpkg'
      );
  }
}
