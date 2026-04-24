/**
 * Felt Like It — BullMQ Worker Process
 *
 * Processes file import jobs: reads uploaded files, parses geo formats
 * via @felt-like-it/import-engine, inserts features into PostGIS, and
 * updates the import_jobs status.
 */

import { Worker, type Job } from 'bullmq';
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
import { ImportJobPayloadSchema, type ImportJobPayload } from '@felt-like-it/shared-types';
import { pool, db, connection } from './db.js';
import { updateJobStatus } from './job-status.js';
import { insertFeaturesBatch } from './feature-insertion.js';
import { geoprocessingWorker } from './geoprocessing.js';
import { staleJobTimer } from './stale-job-reaper.js';
import { logger } from './logger.js';

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

// ─── Graceful shutdown ────────────────────────────────────────────────────────

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
