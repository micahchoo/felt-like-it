/**
 * Felt Like It — BullMQ Worker Process
 *
 * Processes file import jobs: reads uploaded files, parses GeoJSON/CSV,
 * inserts features into PostGIS, and updates the import_jobs status.
 */

import { Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { sql, eq } from 'drizzle-orm';
import { readFile, createReadStream } from 'fs';
import { promisify } from 'util';
import { extname } from 'path';
import {
  validateGeoJSON,
  detectLayerType,
  generateAutoStyle,
  detectCoordinateColumns,
  detectAddressColumn,
  isValidLatitude,
  isValidLongitude,
  geocodeBatch,
  type GeocodingOptions,
} from '@felt-like-it/geo-engine';
import type { ImportJobPayload } from '@felt-like-it/shared-types';
import { logger } from './logger.js';

const readFileAsync = promisify(readFile);

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

// ─── Job processor ────────────────────────────────────────────────────────────

async function processImportJob(job: Job<ImportJobPayload>): Promise<void> {
  const { jobId, mapId, layerName, filePath, fileName } = job.data;

  logger.info({ jobId, fileName }, 'processing job');

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
      throw new Error(`Unsupported format: ${ext}. Supported: .geojson, .json, .csv, .zip, .shp, .kml, .gpx, .gpkg`);
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
  }
}

async function processGeoJSON(
  jobId: string,
  mapId: string,
  layerName: string,
  filePath: string
): Promise<void> {
  const raw = await readFileAsync(filePath, 'utf-8');
  let geojson: unknown;

  try {
    geojson = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON file');
  }

  const validation = validateGeoJSON(geojson);
  if (!validation.valid) {
    throw new Error(`Invalid GeoJSON: ${validation.errors.slice(0, 3).join(', ')}`);
  }

  const data = geojson as { type: string; features?: Array<{ geometry: { type: string; coordinates: unknown }; properties: Record<string, unknown> | null }> };

  let featureList: Array<{ geometry: Record<string, unknown>; properties: Record<string, unknown> }>;

  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    featureList = data.features.map((f) => ({
      geometry: f.geometry as Record<string, unknown>,
      properties: f.properties ?? {},
    }));
  } else if (data.type === 'Feature') {
    const f = data as unknown as { geometry: Record<string, unknown>; properties: Record<string, unknown> | null };
    featureList = [{ geometry: f.geometry, properties: f.properties ?? {} }];
  } else {
    featureList = [{ geometry: data as unknown as Record<string, unknown>, properties: {} }];
  }

  if (featureList.length === 0) throw new Error('No features found');

  const layerType = detectLayerType(featureList.map((f) => ({ geometry: { type: String(f.geometry['type'] ?? 'Point') } })));
  const style = generateAutoStyle(layerType, featureList.map((f) => ({ properties: f.properties })));

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
  const { default: Papa } = await import('papaparse');

  const rows: Record<string, string>[] = [];
  let headers: string[] = [];

  await new Promise<void>((resolve, reject) => {
    Papa.parse(createReadStream(filePath), {
      header: true,
      skipEmptyLines: true,
      step: (result: { meta: { fields?: string[] }; data: unknown }) => {
        if (headers.length === 0 && result.meta.fields) headers = result.meta.fields;
        rows.push(result.data as Record<string, string>);
      },
      complete: () => resolve(),
      error: (err: Error) => reject(err),
    });
  });

  if (rows.length === 0) throw new Error('CSV file is empty');

  type Feat = { geometry: Record<string, unknown>; properties: Record<string, unknown> };
  let features: Feat[];

  // ── Path A: explicit lat/lng columns ───────────────────────────────────────
  const coordCols = detectCoordinateColumns(headers);

  if (coordCols) {
    const { latCol, lngCol } = coordCols;
    const acc: Feat[] = [];

    for (const row of rows) {
      const lat = parseFloat(row[latCol] ?? '');
      const lng = parseFloat(row[lngCol] ?? '');
      if (!isValidLatitude(lat) || !isValidLongitude(lng)) continue;

      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) {
        if (k !== latCol && k !== lngCol) props[k] = v;
      }
      acc.push({ geometry: { type: 'Point', coordinates: [lng, lat] }, properties: props });
    }

    if (acc.length === 0) throw new Error('No valid coordinate rows found');
    features = acc;

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
      acc.push({ geometry: { type: 'Point', coordinates: [point.lng, point.lat] }, properties: props });
    }

    if (acc.length === 0) {
      throw new Error(
        `Geocoding failed for all ${indexed.length} rows. ` +
        'Check address values or NOMINATIM_URL configuration.'
      );
    }
    features = acc;
  }

  const style = generateAutoStyle('point', features.map((f) => ({ properties: f.properties })));

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
      const valueClauses = batch.map((f) =>
        sql`(${layerId}::uuid, ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), ${JSON.stringify(f.properties)}::jsonb)`
      );
      await db.execute(
        sql`INSERT INTO features (layer_id, geometry, properties) VALUES ${sql.join(valueClauses, sql`, `)}`
      );
    }

    inserted += batch.length;
    await onProgress(inserted / features.length);
  }
}

async function processShapefile(
  jobId: string,
  mapId: string,
  layerName: string,
  filePath: string
): Promise<void> {
  const { default: shpjs } = await import('shpjs');
  const { readFile } = await import('fs/promises');
  const { extname } = await import('path');

  const buf = await readFile(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const ext = extname(filePath).toLowerCase();

  type ShpFeature = { type: 'Feature'; geometry: Record<string, unknown>; properties: Record<string, unknown> | null };
  type ShpFC = { type: 'FeatureCollection'; features: ShpFeature[] };

  let rawFeatures: ShpFeature[];

  if (ext === '.zip') {
    const result = await shpjs(arrayBuffer) as ShpFC | ShpFC[];
    const collections = Array.isArray(result) ? result : [result];
    rawFeatures = collections.flatMap((fc) => fc.features ?? []);
  } else {
    const geometries = await shpjs.parseShp(arrayBuffer);
    rawFeatures = geometries.map((geom) => ({ type: 'Feature' as const, geometry: geom as Record<string, unknown>, properties: {} }));
  }

  const features = rawFeatures
    .filter((f) => f.geometry !== null && f.geometry !== undefined)
    .map((f) => ({ geometry: f.geometry as Record<string, unknown>, properties: f.properties ?? {} }));

  if (features.length === 0) throw new Error('Shapefile contains no features');

  const layerType = detectLayerType(features.map((f) => ({ geometry: { type: String(f.geometry['type'] ?? 'Point') } })));
  const style = generateAutoStyle(layerType, features.map((f) => ({ properties: f.properties })));

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

  await insertFeaturesBatch(layerId, features, async (progress) => {
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
  const [{ DOMParser }, togeojson] = await Promise.all([
    import('@xmldom/xmldom'),
    import('@tmcw/togeojson'),
  ]);
  const { readFile } = await import('fs/promises');

  const raw = await readFile(filePath, 'utf-8');
  const doc = new DOMParser().parseFromString(raw, 'text/xml');

  // @tmcw/togeojson v7 accepts `Document | Document$1` (@xmldom/xmldom) — no cast needed.
  const fc =
    format === 'kml'
      ? togeojson.kml(doc)
      : togeojson.gpx(doc);

  type ParsedFeature = { geometry: Record<string, unknown>; properties: Record<string, unknown> };
  const features: ParsedFeature[] = [];
  for (const f of fc.features) {
    if (f.geometry === null) continue;
    features.push({
      // Double-cast: Geometry includes GeometryCollection which lacks an index signature.
      geometry: f.geometry as unknown as Record<string, unknown>,
      properties: (f.properties ?? {}) as Record<string, unknown>,
    });
  }

  if (features.length === 0) {
    throw new Error(`${format.toUpperCase()} file contains no features with valid geometry`);
  }

  const layerType = detectLayerType(
    features.map((f) => ({ geometry: { type: String(f.geometry['type'] ?? 'Point') } }))
  );
  const style = generateAutoStyle(layerType, features.map((f) => ({ properties: f.properties })));

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

  await insertFeaturesBatch(layerId, features, async (progress) => {
    await updateJobStatus(jobId, 'processing', Math.round(15 + progress * 80));
  });
}

async function processGeoPackage(
  jobId: string,
  mapId: string,
  layerName: string,
  filePath: string
): Promise<void> {
  const { default: initSqlJs } = await import('sql.js');
  const { readFile } = await import('fs/promises');

  const buf = await readFile(filePath);
  // sql.js v1.14+ locates sql-wasm.wasm via import.meta.url — no locateFile needed.
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database(new Uint8Array(buf));

  // GeoPackage Binary Header parser (mirrors geopackage.ts in the web app).
  // Converges to a shared import package in Phase 3.
  function parseGpkgBlob(
    blob: Uint8Array
  ): { wkbBytes: Uint8Array; srid: number } | null {
    if (blob.length < 8) return null;
    if (blob[0] !== 0x47 || blob[1] !== 0x50) return null;
    const flags = blob[3] ?? 0;
    if (((flags >> 4) & 0x1) === 1) return null;
    const littleEndian = (flags & 0x1) === 1;
    const envelopeIndicator = (flags >> 1) & 0x7;
    const envelopeSizes: ReadonlyArray<number> = [0, 32, 48, 48, 64];
    const envelopeSize = envelopeIndicator <= 4 ? (envelopeSizes[envelopeIndicator] ?? 0) : 0;
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    const srid = view.getInt32(4, littleEndian);
    const wkbOffset = 8 + envelopeSize;
    if (blob.length <= wkbOffset) return null;
    return { wkbBytes: blob.slice(wkbOffset), srid };
  }

  type SqlValue = number | string | Uint8Array | null;

  try {
    const contentsResult = sqlDb.exec(
      "SELECT table_name, srs_id FROM gpkg_contents WHERE data_type = 'features' ORDER BY table_name"
    );

    const contentsData = contentsResult[0];
    const firstContentRow = contentsData?.values[0];
    if (!contentsData || !firstContentRow) {
      throw new Error('GeoPackage contains no feature tables');
    }

    const tableNameIdx = contentsData.columns.indexOf('table_name');
    const tableName =
      tableNameIdx !== -1 ? String((firstContentRow as SqlValue[])[tableNameIdx] ?? '') : '';

    if (!tableName || !/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(tableName)) {
      throw new Error(`Invalid GeoPackage table name: "${tableName}"`);
    }

    const geomColResult = sqlDb.exec(
      `SELECT column_name, geometry_type_name, srs_id ` +
        `FROM gpkg_geometry_columns WHERE table_name = '${tableName}'`
    );

    const geomData = geomColResult[0];
    const geomRow = geomData?.values[0];
    if (!geomData || !geomRow) {
      throw new Error(`GeoPackage table "${tableName}" has no entry in gpkg_geometry_columns`);
    }

    const geomCols = geomData.columns;
    const geomRowValues = geomRow as SqlValue[];
    const geomColName = String(geomRowValues[geomCols.indexOf('column_name')] ?? 'geom');
    const geomTypeName = String(
      geomRowValues[geomCols.indexOf('geometry_type_name')] ?? 'GEOMETRY'
    );
    const tableSridRaw = geomRowValues[geomCols.indexOf('srs_id')];
    const tableSrid =
      typeof tableSridRaw === 'number' && tableSridRaw > 0 ? tableSridRaw : 4326;

    // Map GPKG geometry type to our layer type (handles Z/M/ZM suffix variants)
    function gpkgLayerType(name: string): 'point' | 'line' | 'polygon' | 'mixed' {
      const n = name.toUpperCase().replace(/(?:ZM|[ZM])$/, '');
      if (n === 'POINT' || n === 'MULTIPOINT') return 'point';
      if (['LINESTRING', 'MULTILINESTRING', 'CIRCULARSTRING', 'COMPOUNDCURVE', 'MULTICURVE'].includes(n))
        return 'line';
      if (['POLYGON', 'MULTIPOLYGON', 'CURVEPOLYGON', 'MULTISURFACE'].includes(n))
        return 'polygon';
      return 'mixed';
    }

    const layerType = gpkgLayerType(geomTypeName);

    const featureResult = sqlDb.exec(`SELECT * FROM "${tableName}"`);
    const featureData = featureResult[0];
    if (!featureData) throw new Error(`GeoPackage table "${tableName}" is empty`);

    const { columns: featureCols, values: featureRows } = featureData;
    const geomColIndex = featureCols.indexOf(geomColName);
    if (geomColIndex === -1) {
      throw new Error(`GeoPackage table "${tableName}" has no column named "${geomColName}"`);
    }

    type WkbRow = { wkbHex: string; srid: number; properties: Record<string, unknown> };
    const wkbRows: WkbRow[] = [];

    for (const rawRow of featureRows) {
      const row = rawRow as SqlValue[];
      const rawBlob = row[geomColIndex];
      if (!(rawBlob instanceof Uint8Array)) continue;
      const parsed = parseGpkgBlob(rawBlob);
      if (parsed === null) continue;

      const properties: Record<string, unknown> = {};
      for (let i = 0; i < featureCols.length; i++) {
        if (i === geomColIndex) continue;
        const col = featureCols[i];
        if (!col || col === 'fid' || col === 'ogc_fid') continue;
        const val = row[i];
        properties[col] = val instanceof Uint8Array ? null : (val ?? null);
      }

      const srid = parsed.srid > 0 ? parsed.srid : tableSrid;
      // Pure JS hex encoding — avoids relying on the Buffer global (not declared
      // in the root ESLint config's globals; Buffer is available at runtime in Node.js).
      const wkbHex = Array.from(parsed.wkbBytes, (b) =>
        (b as number).toString(16).padStart(2, '0')
      ).join('');
      wkbRows.push({ wkbHex, srid, properties });
    }

    if (wkbRows.length === 0) {
      throw new Error(
        `GeoPackage table "${tableName}" contains no features with valid geometry`
      );
    }

    const style = generateAutoStyle(layerType, wkbRows.map((r) => ({ properties: r.properties })));

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

    for (let i = 0; i < wkbRows.length; i += BATCH) {
      const batch = wkbRows.slice(i, i + BATCH);
      const valueClauses = batch.map((r) => {
        const geomExpr =
          r.srid === 4326
            ? sql`ST_GeomFromWKB(decode(${r.wkbHex}, 'hex'), 4326)`
            : sql`ST_Transform(ST_GeomFromWKB(decode(${r.wkbHex}, 'hex'), ${r.srid}), 4326)`;
        return sql`(${layerId}::uuid, ${geomExpr}, ${JSON.stringify(r.properties)}::jsonb)`;
      });
      await db.execute(
        sql`INSERT INTO features (layer_id, geometry, properties) VALUES ${sql.join(valueClauses, sql`, `)}`
      );
      inserted += batch.length;
      const progress = Math.round(10 + (inserted / wkbRows.length) * 80);
      await updateJobStatus(jobId, 'processing', progress);
    }
  } finally {
    sqlDb.close();
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

// ─── Worker setup ─────────────────────────────────────────────────────────────

const worker = new Worker<ImportJobPayload>('file-import', processImportJob, {
  connection,
  concurrency: 3,
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

// Graceful shutdown
async function shutdown(): Promise<void> {
  logger.info('shutting down');
  await worker.close();
  await connection.quit();
  await pool.end();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
