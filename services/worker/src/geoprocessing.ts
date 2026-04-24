import { Worker, type Job } from 'bullmq';
import { sql } from 'drizzle-orm';
import {
  GeoprocessingJobPayloadSchema,
  type GeoprocessingJobPayload,
  type GeoprocessingOp,
} from '@felt-like-it/shared-types';
import { db, connection } from './db.js';
import { updateJobStatus } from './job-status.js';
import { logger } from './logger.js';

async function processGeoprocessingJob(job: Job<GeoprocessingJobPayload>): Promise<void> {
  const { jobId, op, outputLayerId } = GeoprocessingJobPayloadSchema.parse(job.data);

  logger.info({ jobId, opType: op.type }, 'processing geoprocessing job');

  try {
    // Set statement timeout to prevent unbounded operations
    await db.execute(sql`SET LOCAL statement_timeout = '30s'`);

    switch (op.type) {
      case 'buffer':
        await runBuffer(op.layerId, outputLayerId, op.distanceKm * 1000);
        break;
      case 'convex_hull':
        await runConvexHull(op.layerId, outputLayerId);
        break;
      case 'centroid':
        await runCentroid(op.layerId, outputLayerId);
        break;
      case 'dissolve':
        await runDissolve(op.layerId, outputLayerId, op.field);
        break;
      case 'intersect':
        await runIntersect(op.layerIdA, op.layerIdB, outputLayerId);
        break;
      case 'union':
        await runUnion(op.layerId, outputLayerId);
        break;
      case 'clip':
        await runClip(op.layerIdA, op.layerIdB, outputLayerId);
        break;
      case 'point_in_polygon':
        await runPointInPolygon(op.layerIdPoints, op.layerIdPolygons, outputLayerId);
        break;
      case 'nearest_neighbor':
        await runNearestNeighbor(op.layerIdA, op.layerIdB, outputLayerId);
        break;
      case 'aggregate':
        await runAggregate(op, outputLayerId);
        break;
      default: {
        const _exhaustive: never = op;
        throw new Error(`Unknown geoprocessing type: ${(_exhaustive as { type: string }).type}`);
      }
    }

    await updateJobStatus(jobId, 'done', 100);
    logger.info({ jobId, opType: op.type }, 'geoprocessing job completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, error: message }, 'geoprocessing job failed');
    await db.execute(sql`
      UPDATE import_jobs
      SET status = 'failed', error_message = ${message}, updated_at = NOW()
      WHERE id = ${jobId}
    `);
    throw err;
  }
}

// ─── Geoprocessing SQL implementations ───────────────────────────────────────
// These mirror the functions in apps/web/src/lib/server/geo/geoprocessing.ts
// but use raw SQL via drizzle since the worker cannot import from the web app.

async function runBuffer(layerId: string, newLayerId: string, distanceM: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO features (layer_id, geometry, properties)
    SELECT
      ${newLayerId}::uuid,
      ST_Buffer(geometry::geography, ${distanceM})::geometry,
      properties
    FROM features
    WHERE layer_id = ${layerId}::uuid
  `);
}

async function runConvexHull(layerId: string, newLayerId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO features (layer_id, geometry, properties)
    SELECT ${newLayerId}::uuid, ST_ConvexHull(ST_Collect(geometry)), '{}'::jsonb
    FROM features
    WHERE layer_id = ${layerId}::uuid
    HAVING COUNT(*) > 0
  `);
}

async function runCentroid(layerId: string, newLayerId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO features (layer_id, geometry, properties)
    SELECT ${newLayerId}::uuid, ST_Centroid(geometry), properties
    FROM features
    WHERE layer_id = ${layerId}::uuid
  `);
}

async function runDissolve(
  layerId: string,
  newLayerId: string,
  field: string | undefined
): Promise<void> {
  if (field !== undefined) {
    await db.execute(sql`
      INSERT INTO features (layer_id, geometry, properties)
      SELECT
        ${newLayerId}::uuid,
        ST_Union(geometry),
        jsonb_build_object(${field}, MAX(properties->>${field}))
      FROM features
      WHERE layer_id = ${layerId}::uuid
      GROUP BY properties->>${field}
    `);
  } else {
    await db.execute(sql`
      INSERT INTO features (layer_id, geometry, properties)
      SELECT ${newLayerId}::uuid, ST_Union(geometry), '{}'::jsonb
      FROM features
      WHERE layer_id = ${layerId}::uuid
      HAVING COUNT(*) > 0
    `);
  }
}

async function runIntersect(layerIdA: string, layerIdB: string, newLayerId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO features (layer_id, geometry, properties)
    SELECT
      ${newLayerId}::uuid,
      ST_Intersection(a.geometry, b.geometry),
      a.properties
    FROM features a
    JOIN features b
      ON b.layer_id = ${layerIdB}::uuid
      AND ST_Intersects(a.geometry, b.geometry)
    WHERE a.layer_id = ${layerIdA}::uuid
      AND NOT ST_IsEmpty(ST_Intersection(a.geometry, b.geometry))
  `);
}

async function runUnion(layerId: string, newLayerId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO features (layer_id, geometry, properties)
    SELECT ${newLayerId}::uuid, ST_Union(geometry), '{}'::jsonb
    FROM features
    WHERE layer_id = ${layerId}::uuid
    HAVING COUNT(*) > 0
  `);
}

async function runClip(layerIdA: string, layerIdB: string, newLayerId: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO features (layer_id, geometry, properties)
    SELECT
      ${newLayerId}::uuid,
      ST_Intersection(a.geometry, mask.geom),
      a.properties
    FROM features a
    JOIN (
      SELECT ST_Union(geometry) AS geom FROM features WHERE layer_id = ${layerIdB}::uuid
    ) mask
      ON ST_Intersects(a.geometry, mask.geom)
    WHERE a.layer_id = ${layerIdA}::uuid
      AND NOT ST_IsEmpty(ST_Intersection(a.geometry, mask.geom))
  `);
}

async function runPointInPolygon(
  layerIdPoints: string,
  layerIdPolygons: string,
  newLayerId: string
): Promise<void> {
  await db.execute(sql`
    INSERT INTO features (layer_id, geometry, properties)
    SELECT DISTINCT ON (p.id)
      ${newLayerId}::uuid,
      p.geometry,
      CASE
        WHEN poly.id IS NOT NULL THEN p.properties || poly.properties
        ELSE p.properties
      END
    FROM features p
    LEFT JOIN features poly
      ON poly.layer_id = ${layerIdPolygons}::uuid
      AND ST_Within(p.geometry, poly.geometry)
    WHERE p.layer_id = ${layerIdPoints}::uuid
    ORDER BY p.id
  `);
}

async function runNearestNeighbor(
  layerIdA: string,
  layerIdB: string,
  newLayerId: string
): Promise<void> {
  await db.execute(sql`
    INSERT INTO features (layer_id, geometry, properties)
    SELECT
      ${newLayerId}::uuid,
      a.geometry,
      a.properties || nb.properties
    FROM features a
    CROSS JOIN LATERAL (
      SELECT b.properties
      FROM features b
      WHERE b.layer_id = ${layerIdB}::uuid
      ORDER BY a.geometry <-> b.geometry
      LIMIT 1
    ) nb
    WHERE a.layer_id = ${layerIdA}::uuid
  `);
}

async function runAggregate(
  op: Extract<GeoprocessingOp, { type: 'aggregate' }>,
  newLayerId: string
): Promise<void> {
  const outField = op.outputField ?? op.aggregation;

  if (op.aggregation === 'count') {
    await db.execute(sql`
      INSERT INTO features (layer_id, geometry, properties)
      SELECT
        ${newLayerId}::uuid,
        poly.geometry,
        poly.properties || jsonb_build_object(${outField}, COUNT(pt.id))
      FROM features poly
      LEFT JOIN features pt
        ON pt.layer_id = ${op.layerIdPoints}::uuid
        AND ST_Within(pt.geometry, poly.geometry)
      WHERE poly.layer_id = ${op.layerIdPolygons}::uuid
      GROUP BY poly.id, poly.geometry, poly.properties
    `);
  } else if (op.aggregation === 'sum') {
    if (!op.field) throw new Error('field is required for sum aggregation');
    const field = op.field;
    await db.execute(sql`
      INSERT INTO features (layer_id, geometry, properties)
      SELECT
        ${newLayerId}::uuid,
        poly.geometry,
        poly.properties || jsonb_build_object(${outField}, COALESCE(SUM((pt.properties->>${field})::numeric), 0))
      FROM features poly
      LEFT JOIN features pt
        ON pt.layer_id = ${op.layerIdPoints}::uuid
        AND ST_Within(pt.geometry, poly.geometry)
      WHERE poly.layer_id = ${op.layerIdPolygons}::uuid
      GROUP BY poly.id, poly.geometry, poly.properties
    `);
  } else {
    if (!op.field) throw new Error('field is required for avg aggregation');
    const field = op.field;
    await db.execute(sql`
      INSERT INTO features (layer_id, geometry, properties)
      SELECT
        ${newLayerId}::uuid,
        poly.geometry,
        poly.properties || jsonb_build_object(${outField}, AVG((pt.properties->>${field})::numeric))
      FROM features poly
      LEFT JOIN features pt
        ON pt.layer_id = ${op.layerIdPoints}::uuid
        AND ST_Within(pt.geometry, poly.geometry)
      WHERE poly.layer_id = ${op.layerIdPolygons}::uuid
      GROUP BY poly.id, poly.geometry, poly.properties
    `);
  }
}

// ─── Worker setup ─────────────────────────────────────────────────────────────

export const geoprocessingWorker = new Worker<GeoprocessingJobPayload>(
  'geoprocessing',
  processGeoprocessingJob,
  {
    connection,
    concurrency: 1,
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 500 },
  }
);

geoprocessingWorker.on('completed', (job) => {
  logger.info({ jobId: job.id ?? 'unknown' }, 'geoprocessing job completed');
});

geoprocessingWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id ?? 'unknown', error: err.message }, 'geoprocessing job failed');
});

geoprocessingWorker.on('error', (err) => {
  logger.error({ err }, 'geoprocessing worker error');
});

logger.info('geoprocessing worker started, waiting for jobs');
