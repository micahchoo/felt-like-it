import { sql } from 'drizzle-orm';
import { db } from './db.js';

export async function insertFeaturesBatch(
  layerId: string,
  features: Array<{ geometry: Record<string, unknown>; properties: Record<string, unknown> }>,
  onProgress: (ratio: number) => Promise<void>
): Promise<void> {
  const BATCH = 500;
  let inserted = 0;

  for (let i = 0; i < features.length; i += BATCH) {
    const batch = features.slice(i, i + BATCH);

    if (batch.length > 0) {
      // Single multi-row INSERT per batch — one PostgreSQL round-trip regardless of batch size
      const valueClauses = batch.map(
        (f) =>
          sql`(${layerId}::uuid, ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), ${JSON.stringify(f.properties)}::jsonb)`
      );
      // eslint-disable-next-line no-await-in-loop -- sequential batches: progress tracking requires ordered completion
      await db.execute(
        sql`INSERT INTO features (layer_id, geometry, properties) VALUES ${sql.join(valueClauses, sql`, `)}`
      );
    }

    inserted += batch.length;
    // eslint-disable-next-line no-await-in-loop -- progress callback depends on sequential batch count
    await onProgress(inserted / features.length);
  }
}
