/**
 * Felt Like It — BullMQ Worker Process
 *
 * Processes file import jobs: reads uploaded files, parses geo formats
 * via @felt-like-it/import-engine, inserts features into PostGIS, and
 * updates the import_jobs status.
 */

import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { unlink } from 'fs/promises';
import { extname, resolve } from 'path';
import {
  parseGeoJSON,
  parseCSV,
  csvRowsToFeatures,
  parseShapefile,
  parseKML,
  parseGPX,
  parseGeoPackage,
} from '@felt-like-it/import-engine';
import {
  detectLayerType,
  generateAutoStyle,
  detectCoordinateColumns,
  detectAddressColumn,
  geocodeBatch,
  type GeocodingOptions,
} from '@felt-like-it/geo-engine';
import {
  ImportJobPayloadSchema,
  type ImportJobPayload,
  GeoprocessingJobPayloadSchema,
  type GeoprocessingJobPayload,
  type GeoprocessingOp,
} from '@felt-like-it/shared-types';
import { logger } from './logger.js';

// ─── Database connection ───────────────────────────────────────────────────────

const pool = new pg.Pool({
  connectionString: process.env['DATABASE_URL'] ?? 'postgresql://felt:felt@localhost:5432/felt',
  max: 5,
});

const db = drizzle(pool);

// ─── Redis connection ──────────────────────────────────────────────────────────

const connection = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
});

// ─── Upload directory (must match the web app's UPLOAD_DIR) ───────────────────

const UPLOAD_DIR = resolve(process.env['UPLOAD_DIR'] ?? '/tmp/felt-uploads');

// ─── Job processor ────────────────────────────────────────────────────────────

async function processImportJob(job: Job<ImportJobPayload>): Promise<void> {
  const { jobId, mapId, layerName, filePath, fileName } = ImportJobPayloadSchema.parse(job.data);

  // ── Path-traversal guard: reject paths outside the upload directory ────────
  const resolvedPath = resolve(filePath);
  if (!resolvedPath.startsWith(UPLOAD_DIR + '/')) {
    throw new Error(
      `Security: filePath "${filePath}" resolves outside UPLOAD_DIR ("${UPLOAD_DIR}"). Job rejected.`
    );
  }

  logger.info({ jobId, fileName }, 'processing job');

  // Clean up partial state from previous failed attempt (BullMQ retry)
  const { rows: existingRows } = await pool.query<{ layer_id: string }>(
    `SELECT layer_id FROM import_jobs WHERE id = $1 AND layer_id IS NOT NULL`,
    [jobId]
  );
  if (existingRows[0]?.layer_id) {
    const staleLayerId = existingRows[0].layer_id;
    logger.info({ jobId, staleLayerId }, 'cleaning up partial layer from previous attempt');
    await pool.query(`DELETE FROM features WHERE layer_id = $1`, [staleLayerId]);
    await pool.query(`DELETE FROM layers WHERE id = $1`, [staleLayerId]);
    await pool.query(`UPDATE import_jobs SET layer_id = NULL WHERE id = $1`, [jobId]);
  }

  await updateJobStatus(jobId, 'processing', 5);

  const ext = extname(fileName).toLowerCase();

  try {
    if (ext === '.geojson' || ext === '.json') {
      await processGeoJSON(jobId, mapId, layerName, filePath);
    } else if (ext === '.csv') {
      await processCSV(jobId, mapId, layerName, filePath);
    } else if (ext === '.zip' || ext === '.shp') {
      await processShapefile(jobId, mapId, layerName, filePath);
    } else if (ext === '.kml') {
      await processXmlGeo(jobId, mapId, layerName, filePath, 'kml');
    } else if (ext === '.gpx') {
      await processXmlGeo(jobId, mapId, layerName, filePath, 'gpx');
    } else if (ext === '.gpkg') {
      await processGeoPackage(jobId, mapId, layerName, filePath);
    } else {
      throw new Error(
        `Unsupported format: ${ext}. Supported: .geojson, .json, .csv, .zip, .shp, .kml, .gpx, .gpkg`
      );
    }

    await updateJobStatus(jobId, 'done', 100);
    logger.info({ jobId }, 'job completed successfully');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, error: message }, 'job failed');
    await db.execute(sql`
      UPDATE import_jobs
      SET status = 'failed', error_message = ${message}, updated_at = NOW()
      WHERE id = ${jobId}
    `);
    throw err;
  } finally {
    // Clean up the uploaded file — it has been ingested into PostGIS (or the job failed)
    try {
      await unlink(resolvedPath);
      logger.info({ jobId, filePath: resolvedPath }, 'cleaned up uploaded file');
    } catch (unlinkErr) {
      // File may already be gone (previous attempt, external cleanup) — not fatal
      if ((unlinkErr as NodeJS.ErrnoException).code !== 'ENOENT') {
        logger.warn(
          { jobId, filePath: resolvedPath, error: (unlinkErr as Error).message },
          'failed to clean up uploaded file'
        );
      }
    }
  }
}

async function processGeoJSON(
  jobId: string,
  mapId: string,
  layerName: string,
  filePath: string
): Promise<void> {
  const features = await parseGeoJSON(filePath);

  const featureList = features.map((f) => ({
    geometry: f.geometry as Record<string, unknown>,
    properties: f.properties,
  }));

  const layerType = detectLayerType(
    featureList.map((f) => ({
      geometry: { type: String((f.geometry as Record<string, unknown>)['type'] ?? 'Point') },
    }))
  );
  const style = generateAutoStyle(
    layerType,
    featureList.map((f) => ({ properties: f.properties }))
  );

  const layerResult = await db.execute(sql`
    INSERT INTO layers (map_id, name, type, style, source_file_name)
    VALUES (${mapId}, ${layerName}, ${layerType}, ${JSON.stringify(style)}::jsonb, ${layerName})
    RETURNING id
  `);

  const layerId = layerResult.rows[0]?.['id'] as string | undefined;
  if (!layerId) throw new Error('Failed to create layer');

  await db.execute(sql`
    UPDATE import_jobs SET layer_id = ${layerId}, progress = 15, updated_at = NOW()
    WHERE id = ${jobId}
  `);

  await insertFeaturesBatch(layerId, featureList, async (progress) => {
    await updateJobStatus(jobId, 'processing', Math.round(15 + progress * 80));
  });
}

async function processCSV(
  jobId: string,
  mapId: string,
  layerName: string,
  filePath: string
): Promise<void> {
  const { headers, rows } = await parseCSV(filePath);

  if (rows.length === 0) throw new Error('CSV file is empty');

  type Feat = { geometry: Record<string, unknown>; properties: Record<string, unknown> };
  let features: Feat[];

  // ── Path A: explicit lat/lng columns ───────────────────────────────────────
  const coordCols = detectCoordinateColumns(headers);

  if (coordCols) {
    const parsed = csvRowsToFeatures(headers, rows);
    features = parsed.map((f) => ({
      geometry: f.geometry as Record<string, unknown>,
      properties: f.properties,
    }));

    // ── Path B: address column → Nominatim geocoding ───────────────────────────
  } else {
    const addrCol = detectAddressColumn(headers);

    if (!addrCol) {
      throw new Error(
        'Could not detect lat/lng columns, and no address column was found. ' +
          'Add lat/lng columns, or name an address column "address", "location", or similar.'
      );
    }

    const indexed = rows
      .map((row, i) => ({ row, i, address: (row[addrCol] ?? '').trim() }))
      .filter(({ address }) => address.length > 0);

    if (indexed.length === 0) throw new Error(`Address column "${addrCol}" is empty in all rows`);

    const geocodingOptions: GeocodingOptions = {
      nominatimUrl: process.env['NOMINATIM_URL'] ?? undefined,
      userAgent: process.env['GEOCODING_USER_AGENT'] ?? 'felt-like-it/1.0',
      rateDelayMs: 1_100,
    };

    const geocodeResults = await geocodeBatch(
      indexed.map(({ address }) => address),
      async (completed, total) => {
        await updateJobStatus(jobId, 'processing', Math.round(10 + (completed / total) * 80));
      },
      geocodingOptions
    );

    const acc: Feat[] = [];
    for (let i = 0; i < indexed.length; i++) {
      const point = geocodeResults[i];
      if (!point) continue;
      const { row } = indexed[i] as { row: Record<string, string>; i: number; address: string };
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) props[k] = v;
      acc.push({
        geometry: { type: 'Point', coordinates: [point.lng, point.lat] },
        properties: props,
      });
    }

    if (acc.length === 0) {
      throw new Error(
        `Geocoding failed for all ${indexed.length} rows. ` +
          'Check address values or NOMINATIM_URL configuration.'
      );
    }
    features = acc;
  }

  const style = generateAutoStyle(
    'point',
    features.map((f) => ({ properties: f.properties }))
  );

  const layerResult = await db.execute(sql`
    INSERT INTO layers (map_id, name, type, style, source_file_name)
    VALUES (${mapId}, ${layerName}, 'point', ${JSON.stringify(style)}::jsonb, ${layerName})
    RETURNING id
  `);

  const layerId = layerResult.rows[0]?.['id'] as string | undefined;
  if (!layerId) throw new Error('Failed to create layer');

  await db.execute(sql`
    UPDATE import_jobs SET layer_id = ${layerId}, progress = 15, updated_at = NOW()
    WHERE id = ${jobId}
  `);

  await insertFeaturesBatch(layerId, features, async (progress) => {
    await updateJobStatus(jobId, 'processing', Math.round(15 + progress * 80));
  });
}

async function insertFeaturesBatch(
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

async function processShapefile(
  jobId: string,
  mapId: string,
  layerName: string,
  filePath: string
): Promise<void> {
  const features = await parseShapefile(filePath);

  const featureList = features.map((f) => ({
    geometry: f.geometry as Record<string, unknown>,
    properties: f.properties,
  }));

  const layerType = detectLayerType(
    featureList.map((f) => ({
      geometry: { type: String((f.geometry as Record<string, unknown>)['type'] ?? 'Point') },
    }))
  );
  const style = generateAutoStyle(
    layerType,
    featureList.map((f) => ({ properties: f.properties }))
  );

  const layerResult = await db.execute(sql`
    INSERT INTO layers (map_id, name, type, style, source_file_name)
    VALUES (${mapId}, ${layerName}, ${layerType}, ${JSON.stringify(style)}::jsonb, ${layerName})
    RETURNING id
  `);
  const layerId = layerResult.rows[0]?.['id'] as string | undefined;
  if (!layerId) throw new Error('Failed to create layer');

  await db.execute(sql`
    UPDATE import_jobs SET layer_id = ${layerId}, progress = 15, updated_at = NOW() WHERE id = ${jobId}
  `);

  await insertFeaturesBatch(layerId, featureList, async (progress) => {
    await updateJobStatus(jobId, 'processing', Math.round(15 + progress * 80));
  });
}

async function processXmlGeo(
  jobId: string,
  mapId: string,
  layerName: string,
  filePath: string,
  format: 'kml' | 'gpx'
): Promise<void> {
  const features = format === 'kml' ? await parseKML(filePath) : await parseGPX(filePath);

  if (features.length === 0) {
    throw new Error(`${format.toUpperCase()} file contains no features with valid geometry`);
  }

  const featureList = features.map((f) => ({
    geometry: f.geometry as Record<string, unknown>,
    properties: f.properties,
  }));

  const layerType = detectLayerType(
    featureList.map((f) => ({
      geometry: { type: String((f.geometry as Record<string, unknown>)['type'] ?? 'Point') },
    }))
  );
  const style = generateAutoStyle(
    layerType,
    featureList.map((f) => ({ properties: f.properties }))
  );

  const layerResult = await db.execute(sql`
    INSERT INTO layers (map_id, name, type, style, source_file_name)
    VALUES (${mapId}, ${layerName}, ${layerType}, ${JSON.stringify(style)}::jsonb, ${layerName})
    RETURNING id
  `);
  const layerId = layerResult.rows[0]?.['id'] as string | undefined;
  if (!layerId) throw new Error('Failed to create layer');

  await db.execute(sql`
    UPDATE import_jobs SET layer_id = ${layerId}, progress = 15, updated_at = NOW() WHERE id = ${jobId}
  `);

  await insertFeaturesBatch(layerId, featureList, async (progress) => {
    await updateJobStatus(jobId, 'processing', Math.round(15 + progress * 80));
  });
}

async function processGeoPackage(
  jobId: string,
  mapId: string,
  layerName: string,
  filePath: string
): Promise<void> {
  const { features, layerType } = await parseGeoPackage(filePath);

  const style = generateAutoStyle(
    layerType,
    features.map((r) => ({ properties: r.properties }))
  );

  const layerResult = await db.execute(sql`
    INSERT INTO layers (map_id, name, type, style, source_file_name)
    VALUES (${mapId}, ${layerName}, ${layerType}, ${JSON.stringify(style)}::jsonb, ${layerName})
    RETURNING id
  `);
  const layerId = layerResult.rows[0]?.['id'] as string | undefined;
  if (!layerId) throw new Error('Failed to create layer');

  await db.execute(sql`
    UPDATE import_jobs SET layer_id = ${layerId}, progress = 10, updated_at = NOW()
    WHERE id = ${jobId}
  `);

  const BATCH = 500;
  let inserted = 0;

  for (let i = 0; i < features.length; i += BATCH) {
    const batch = features.slice(i, i + BATCH);
    const valueClauses = batch.map((r) => {
      const geomExpr =
        r.srid === 4326
          ? sql`ST_GeomFromWKB(decode(${r.wkbHex}, 'hex'), 4326)`
          : sql`ST_Transform(ST_GeomFromWKB(decode(${r.wkbHex}, 'hex'), ${r.srid}), 4326)`;
      return sql`(${layerId}::uuid, ${geomExpr}, ${JSON.stringify(r.properties)}::jsonb)`;
    });
    // eslint-disable-next-line no-await-in-loop -- sequential batches: progress tracking requires ordered completion
    await db.execute(
      sql`INSERT INTO features (layer_id, geometry, properties) VALUES ${sql.join(valueClauses, sql`, `)}`
    );
    inserted += batch.length;
    const progress = Math.round(10 + (inserted / features.length) * 80);
    // eslint-disable-next-line no-await-in-loop -- progress update depends on sequential batch count
    await updateJobStatus(jobId, 'processing', progress);
  }
}

async function updateJobStatus(
  jobId: string,
  status: 'processing' | 'done' | 'failed',
  progress: number
): Promise<void> {
  await db.execute(sql`
    UPDATE import_jobs
    SET status = ${status}, progress = ${progress}, updated_at = NOW()
    WHERE id = ${jobId}
  `);
}

// ─── Geoprocessing job processor ─────────────────────────────────────────────

async function processGeoprocessingJob(job: Job<GeoprocessingJobPayload>): Promise<void> {
  const { jobId, op, outputLayerId } = GeoprocessingJobPayloadSchema.parse(job.data);

  logger.info({ jobId, opType: op.type }, 'processing geoprocessing job');

  try {
    // Set statement timeout to prevent unbounded operations
    await db.execute(sql`SET LOCAL statement_timeout = '30s'`);

    // Dispatch to the appropriate SQL handler
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

const worker = new Worker<ImportJobPayload>('file-import', processImportJob, {
  connection,
  concurrency: 3,
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 500 },
});

worker.on('completed', (job) => {
  logger.info({ jobId: job.id ?? 'unknown' }, 'job completed');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id ?? 'unknown', error: err.message }, 'job failed');
});

worker.on('error', (err) => {
  logger.error({ err }, 'worker error');
});

logger.info('import worker started, waiting for jobs');

// ─── Geoprocessing worker setup ──────────────────────────────────────────────

const geoprocessingWorker = new Worker<GeoprocessingJobPayload>(
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

// ─── Stale job reaper ────────────────────────────────────────────────────────
// Jobs stuck in 'processing' for >1 hour were likely owned by a killed worker.
// Mark them failed so the UI doesn't show a perpetual spinner.

const STALE_JOB_INTERVAL_MS = 60 * 60 * 1_000; // 1 hour

async function reapStaleJobs(): Promise<void> {
  try {
    const result = await pool.query(
      `UPDATE import_jobs
       SET status = 'failed', error_message = 'Timed out: worker did not complete within 1 hour', updated_at = NOW()
       WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '1 hour'`
    );
    if ((result.rowCount ?? 0) > 0) {
      logger.info({ count: result.rowCount }, 'reaped stale jobs');
    }
  } catch (err) {
    logger.error({ error: (err as Error).message }, 'stale job reaper failed');
  }
}

// Run once at startup (catches leftovers from previous crash), then hourly
void reapStaleJobs();
const staleJobTimer = setInterval(reapStaleJobs, STALE_JOB_INTERVAL_MS);

// Graceful shutdown
async function shutdown(): Promise<void> {
  logger.info('shutting down');
  clearInterval(staleJobTimer);
  await worker.close();
  await geoprocessingWorker.close();
  await connection.quit();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
