import { parseKML, parseGPX } from '@felt-like-it/import-engine';
import { createLayerAndInsertFeatures } from './shared.js';
import type { ImportResult } from './shared.js';

/** Format handled by this module — KML and GPX are both XML-based geo formats */
export type XmlGeoFormat = 'kml' | 'gpx';

/**
 * Import a KML or GPX file into a new layer.
 *
 * KML Placemarks and GPX waypoints/tracks are converted to GeoJSON features
 * by the import-engine parsers and inserted into PostGIS in batches of 500.
 */
export async function importXmlGeo(
  filePath: string,
  mapId: string,
  layerName: string,
  jobId: string,
  format: XmlGeoFormat
): Promise<ImportResult> {
  const featureList = format === 'kml'
    ? await parseKML(filePath)
    : await parseGPX(filePath);

  if (featureList.length === 0) {
    throw new Error(
      `${format.toUpperCase()} file contains no features with valid geometry`
    );
  }

  return createLayerAndInsertFeatures({
    mapId,
    jobId,
    layerName,
    features: featureList,
  });
}
