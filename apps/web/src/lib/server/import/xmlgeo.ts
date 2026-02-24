import { readFile } from 'fs/promises';
import { detectLayerType, generateAutoStyle } from '@felt-like-it/geo-engine';
import { db, layers, importJobs } from '../db/index.js';
import { insertFeatures, getLayerBbox } from '../geo/queries.js';
import { eq } from 'drizzle-orm';
import type { ImportResult } from './geojson.js';

/** Format handled by this module — KML and GPX are both XML-based geo formats */
export type XmlGeoFormat = 'kml' | 'gpx';

type ParsedFeature = {
  geometry: Record<string, unknown>;
  properties: Record<string, unknown>;
};

/**
 * Parse a KML or GPX file into normalized GeoJSON features.
 *
 * Uses @tmcw/togeojson for KML/GPX → GeoJSON conversion and @xmldom/xmldom
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
      // f.geometry is narrowed to non-null Geometry by the guard above.
      // Double-cast via unknown: Geometry includes GeometryCollection which lacks
      // an index signature, preventing a direct cast to Record<string, unknown>.
      geometry: f.geometry as unknown as Record<string, unknown>,
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

  const layerType = detectLayerType(
    featureList.map((f) => ({ geometry: { type: String(f.geometry['type'] ?? 'Point') } }))
  );

  const autoStyle = generateAutoStyle(
    layerType,
    featureList.map((f) => ({ properties: f.properties }))
  );

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
