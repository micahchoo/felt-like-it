import {
  parseGeoPackage,
  parseGpkgBlob,
  gpkgGeomTypeToLayerType,
} from '@felt-like-it/import-engine';
import { generateAutoStyle } from '@felt-like-it/geo-engine';
import { db, layers, importJobs } from '../db/index.js';
import { insertWkbFeatures, getLayerBbox, type WkbFeatureRow } from '../geo/queries.js';
import { eq } from 'drizzle-orm';
import type { ImportResult } from './shared.js';

// Re-export pure helpers for tests
export { parseGpkgBlob, gpkgGeomTypeToLayerType };

/**
 * Import a GeoPackage (.gpkg) file into a new PostGIS layer.
 *
 * Uses import-engine to parse the GeoPackage SQLite container and extract
 * features as WKB hex. DB layer creation and WKB insertion stay here.
 */
export async function importGeoPackage(
  filePath: string,
  mapId: string,
  layerName: string,
  jobId: string
): Promise<ImportResult> {
  const { features, layerType, tableName: _tableName } = await parseGeoPackage(filePath);

  // ── Create layer ───────────────────────────────────────────────────────────
  const autoStyle = generateAutoStyle(
    layerType,
    features.map((r) => ({ properties: r.properties }))
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

  // ── Batch insert features ─────────────────────────────────────────────────
  const BATCH_SIZE = 500;
  let inserted = 0;

  // Convert ParsedWkbFeature[] to WkbFeatureRow[] for insertWkbFeatures
  const wkbRows: WkbFeatureRow[] = features.map((f) => ({
    wkbBytes: new Uint8Array(
      (f.wkbHex.match(/.{2}/g) ?? []).map((byte) => parseInt(byte, 16))
    ),
    srid: f.srid,
    properties: f.properties,
  }));

  for (let i = 0; i < wkbRows.length; i += BATCH_SIZE) {
    const batch = wkbRows.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop -- sequential batches: progress tracking requires ordered completion
    await insertWkbFeatures(layer.id, batch);
    inserted += batch.length;

    const progress = Math.round(10 + (inserted / wkbRows.length) * 80);
    // eslint-disable-next-line no-await-in-loop -- progress update depends on sequential batch count
    await db.update(importJobs).set({ progress }).where(eq(importJobs.id, jobId));
  }

  const bbox = await getLayerBbox(layer.id);
  return { layerId: layer.id, featureCount: inserted, bbox };
}
