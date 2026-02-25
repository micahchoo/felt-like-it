import { readFile } from 'fs/promises';
import type { Geometry } from '@felt-like-it/shared-types';
import type { Geometry as GeoJSONGeometry } from 'geojson';
import { createLayerAndInsertFeatures } from './shared.js';
import type { ImportResult } from './shared.js';

/**
 * Narrow a GeoJSON Geometry (which includes GeometryCollection) to the
 * project's Geometry type (which excludes it). Throws on GeometryCollection
 * since the project schema does not support it.
 */
function toProjectGeometry(g: GeoJSONGeometry): Geometry {
  if (g.type === 'GeometryCollection') {
    throw new Error('GeometryCollection is not supported');
  }
  return g as Geometry;
}

/** Format handled by this module — KML and GPX are both XML-based geo formats */
export type XmlGeoFormat = 'kml' | 'gpx';

type ParsedFeature = {
  geometry: Geometry;
  properties: Record<string, unknown>;
};

/**
 * Parse a KML or GPX file into normalized GeoJSON features.
 *
 * Uses @tmcw/togeojson for KML/GPX -> GeoJSON conversion and @xmldom/xmldom
 * as the DOM parser in Node.js (no browser DOM available).
 *
 * Features with null geometry are silently dropped — KML Folders and GPX
 * route metadata often produce null-geometry features.
 */
async function parseXmlGeo(filePath: string, format: XmlGeoFormat): Promise<ParsedFeature[]> {
  const [{ DOMParser }, togeojson] = await Promise.all([
    import('@xmldom/xmldom'),
    import('@tmcw/togeojson'),
  ]);

  const raw = await readFile(filePath, 'utf-8');
  const doc = new DOMParser().parseFromString(raw, 'text/xml');

  // @tmcw/togeojson v7 accepts `Document | Document$1` where Document$1 is
  // @xmldom/xmldom's Document — no cast required.
  const fc =
    format === 'kml'
      ? togeojson.kml(doc)
      : togeojson.gpx(doc);

  const features: ParsedFeature[] = [];
  for (const f of fc.features) {
    if (f.geometry === null) continue;
    features.push({
      geometry: toProjectGeometry(f.geometry),
      properties: (f.properties ?? {}) as Record<string, unknown>,
    });
  }
  return features;
}

/**
 * Import a KML or GPX file into a new layer.
 *
 * KML Placemarks and GPX waypoints/tracks are converted to GeoJSON by
 * @tmcw/togeojson and inserted into PostGIS in batches of 500.
 */
export async function importXmlGeo(
  filePath: string,
  mapId: string,
  layerName: string,
  jobId: string,
  format: XmlGeoFormat
): Promise<ImportResult> {
  const featureList = await parseXmlGeo(filePath, format);

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
