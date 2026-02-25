import { detectLayerType, generateAutoStyle } from '@felt-like-it/geo-engine';
import type { Geometry } from '@felt-like-it/shared-types';
import { db, layers, importJobs } from '../db/index.js';
import { insertFeatures, getLayerBbox } from '../geo/queries.js';
import { eq } from 'drizzle-orm';

export interface ImportResult {
  layerId: string;
  featureCount: number;
  bbox: [number, number, number, number] | null;
}

const BATCH_SIZE = 500;

/**
 * Shared tail for all import pipelines:
 * detect layer type, auto-style, create layer, batch-insert with progress, get bbox.
 */
export async function createLayerAndInsertFeatures(opts: {
  mapId: string;
  jobId: string;
  layerName: string;
  features: Array<{ geometry: Geometry; properties: Record<string, unknown> }>;
  /** Override auto-detected layer type (e.g. CSV always 'Point') */
  layerTypeOverride?: 'point' | 'line' | 'polygon' | 'mixed';
}): Promise<ImportResult> {
  const { mapId, jobId, layerName, features } = opts;

  const layerType =
    opts.layerTypeOverride ??
    detectLayerType(features.map((f) => ({ geometry: { type: f.geometry.type } })));
  const autoStyle = generateAutoStyle(
    layerType,
    features.map((f) => ({ properties: f.properties }))
  );

  const [layer] = await db
    .insert(layers)
    .values({ mapId, name: layerName, type: layerType, style: autoStyle, sourceFileName: layerName })
    .returning();

  if (!layer) throw new Error('Failed to create layer');

  await db
    .update(importJobs)
    .set({ layerId: layer.id, progress: 10, status: 'processing' })
    .where(eq(importJobs.id, jobId));

  let inserted = 0;

  for (let i = 0; i < features.length; i += BATCH_SIZE) {
    const batch = features.slice(i, i + BATCH_SIZE);
    // eslint-disable-next-line no-await-in-loop -- sequential batches: progress tracking requires ordered completion
    await insertFeatures(layer.id, batch);
    inserted += batch.length;

    const progress = Math.round(10 + (inserted / features.length) * 80);
    // eslint-disable-next-line no-await-in-loop -- progress update depends on sequential batch count
    await db
      .update(importJobs)
      .set({ progress })
      .where(eq(importJobs.id, jobId));
  }

  const bbox = await getLayerBbox(layer.id);

  return { layerId: layer.id, featureCount: inserted, bbox };
}
