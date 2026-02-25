import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Geometry } from '@felt-like-it/shared-types';
import { db } from '../db/index.js';

/**
 * Execute raw SQL and return typed rows.
 * Drizzle's db.execute() returns untyped rows for raw SQL.
 * This wrapper centralizes the single unavoidable cast.
 */
// TYPE_DEBT: Drizzle's execute() returns { rows: unknown[] } for raw SQL — one cast here replaces many downstream
export async function typedExecute<T>(query: SQL): Promise<T[]> {
  const result = await db.execute(query);
  return result.rows as unknown as T[];
}

export interface GeoJSONFeatureRow {
  id: string;
  layerId: string;
  geometry: Geometry;
  properties: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Fetch all features for a layer as GeoJSON-ready rows.
 * Uses ST_AsGeoJSON to convert PostGIS geometry to GeoJSON.
 */
export async function getLayerFeatures(layerId: string): Promise<GeoJSONFeatureRow[]> {
  return typedExecute<GeoJSONFeatureRow>(sql`
    SELECT
      id,
      layer_id AS "layerId",
      ST_AsGeoJSON(geometry)::json AS geometry,
      properties,
      created_at AS "createdAt",
      updated_at AS "updatedAt"
    FROM features
    WHERE layer_id = ${layerId}
    ORDER BY created_at ASC
  `);
}

/**
 * Insert a batch of GeoJSON features into a layer using a single multi-row INSERT.
 * One round-trip per call regardless of batch size — critical for large datasets.
 * Caller is responsible for chunking into reasonably-sized batches (≤500 recommended).
 */
export async function insertFeatures(
  layerId: string,
  geoJsonFeatures: Array<{
    geometry: Geometry;
    properties: Record<string, unknown>;
  }>
): Promise<void> {
  if (geoJsonFeatures.length === 0) return;

  // Build a multi-row VALUES clause: single round-trip to PostgreSQL per batch
  const valueClauses = geoJsonFeatures.map((f) =>
    sql`(${layerId}::uuid, ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), ${JSON.stringify(f.properties)}::jsonb)`
  );

  await db.execute(
    sql`INSERT INTO features (layer_id, geometry, properties) VALUES ${sql.join(valueClauses, sql`, `)}`
  );
}

/**
 * Get the bounding box of all features in a layer.
 * Returns [minLng, minLat, maxLng, maxLat] or null if no features.
 */
export async function getLayerBbox(
  layerId: string
): Promise<[number, number, number, number] | null> {
  const result = await db.execute(sql`
    SELECT
      ST_XMin(ST_Extent(geometry)) AS min_lng,
      ST_YMin(ST_Extent(geometry)) AS min_lat,
      ST_XMax(ST_Extent(geometry)) AS max_lng,
      ST_YMax(ST_Extent(geometry)) AS max_lat
    FROM features
    WHERE layer_id = ${layerId}
  `);

  const row = result.rows[0];
  if (!row || row['min_lng'] === null) return null;

  return [
    Number(row['min_lng']),
    Number(row['min_lat']),
    Number(row['max_lng']),
    Number(row['max_lat']),
  ];
}

/**
 * Delete all features in a layer.
 */
export async function clearLayerFeatures(layerId: string): Promise<void> {
  await db.execute(sql`
    DELETE FROM features WHERE layer_id = ${layerId}
  `);
}

/**
 * Count features in a layer.
 */
export async function countLayerFeatures(layerId: string): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*) AS count FROM features WHERE layer_id = ${layerId}
  `);
  return Number(result.rows[0]?.['count'] ?? 0);
}

/**
 * Delete a layer and all its features (CASCADE).
 * Used to clean up partial imports before a BullMQ retry.
 */
export async function deleteLayer(layerId: string): Promise<void> {
  await db.execute(sql`DELETE FROM layers WHERE id = ${layerId}`);
}

/**
 * A raw WKB (Well-Known Binary) feature row from a GeoPackage or other
 * binary geometry source. WKB payload and SRID are passed directly to
 * PostGIS, which handles geometry parsing and optional CRS reprojection.
 */
export interface WkbFeatureRow {
  /** Standard WKB bytes (GeoPackage binary header already stripped). */
  wkbBytes: Uint8Array;
  /**
   * Spatial Reference System ID from the source file header.
   * 4326 → no reprojection; any other positive value → ST_Transform to 4326.
   */
  srid: number;
  properties: Record<string, unknown>;
}

/**
 * Insert a batch of WKB features (e.g. from GeoPackage) into a layer.
 * Passes WKB hex directly to PostGIS — PostGIS owns geometry parsing and
 * CRS reprojection (ST_Transform when srid ≠ 4326).
 * One round-trip per call; caller is responsible for chunking to ≤500 rows.
 */
export async function insertWkbFeatures(
  layerId: string,
  features: WkbFeatureRow[]
): Promise<void> {
  if (features.length === 0) return;

  const valueClauses = features.map((f) => {
    const wkbHex = Buffer.from(f.wkbBytes).toString('hex');
    const geomExpr =
      f.srid === 4326
        ? sql`ST_GeomFromWKB(decode(${wkbHex}, 'hex'), 4326)`
        : sql`ST_Transform(ST_GeomFromWKB(decode(${wkbHex}, 'hex'), ${f.srid}), 4326)`;
    return sql`(${layerId}::uuid, ${geomExpr}, ${JSON.stringify(f.properties)}::jsonb)`;
  });

  await db.execute(
    sql`INSERT INTO features (layer_id, geometry, properties) VALUES ${sql.join(valueClauses, sql`, `)}`
  );
}

/**
 * Get the layer_id currently associated with an import job.
 * Returns null if the job hasn't created a layer yet.
 */
export async function getImportJobLayerId(jobId: string): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT layer_id FROM import_jobs WHERE id = ${jobId}
  `);
  const layerId = result.rows[0]?.['layer_id'];
  return typeof layerId === 'string' ? layerId : null;
}
