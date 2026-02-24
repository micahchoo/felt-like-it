/**
 * PostGIS geoprocessing operations.
 *
 * Each function executes a single INSERT…SELECT against the features table,
 * reading from source layer(s) and writing into a pre-created output layer.
 *
 * The public entry point is `runGeoprocessing`, which dispatches on the
 * GeoprocessingOp discriminated union. The exhaustive `assertNever` default
 * case turns any unhandled union member into a compile-time error.
 */

import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import type { GeoprocessingOp } from '@felt-like-it/shared-types';

// ─── Exhaustiveness helper ────────────────────────────────────────────────────

function assertNever(x: never): never {
  throw new Error(`Unhandled geoprocessing op: ${JSON.stringify(x)}`);
}

// ─── Public dispatch ──────────────────────────────────────────────────────────

/**
 * Execute a geoprocessing operation and write results into `newLayerId`.
 * Caller is responsible for creating the output layer row before calling this.
 */
export async function runGeoprocessing(op: GeoprocessingOp, newLayerId: string): Promise<void> {
  switch (op.type) {
    case 'buffer':
      await runBuffer(op.layerId, newLayerId, op.distanceKm * 1000);
      break;
    case 'convex_hull':
      await runConvexHull(op.layerId, newLayerId);
      break;
    case 'centroid':
      await runCentroid(op.layerId, newLayerId);
      break;
    case 'dissolve':
      await runDissolve(op.layerId, newLayerId, op.field);
      break;
    case 'intersect':
      await runIntersect(op.layerIdA, op.layerIdB, newLayerId);
      break;
    case 'union':
      await runUnion(op.layerId, newLayerId);
      break;
    case 'clip':
      await runClip(op.layerIdA, op.layerIdB, newLayerId);
      break;
    default:
      assertNever(op);
  }
}

/**
 * Return the set of source layer IDs required by an op.
 * Used for ownership verification before execution.
 * The exhaustive default ensures new op variants must be handled here too.
 */
export function getOpLayerIds(op: GeoprocessingOp): string[] {
  switch (op.type) {
    case 'buffer':
    case 'convex_hull':
    case 'centroid':
    case 'dissolve':
    case 'union':
      return [op.layerId];
    case 'intersect':
    case 'clip':
      return [op.layerIdA, op.layerIdB];
    default:
      return assertNever(op);
  }
}

// ─── Per-operation PostGIS implementations ────────────────────────────────────

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
    // Group-dissolve: union geometries that share the same value for `field`
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
    // Total dissolve: merge all features into a single geometry
    await db.execute(sql`
      INSERT INTO features (layer_id, geometry, properties)
      SELECT ${newLayerId}::uuid, ST_Union(geometry), '{}'::jsonb
      FROM features
      WHERE layer_id = ${layerId}::uuid
      HAVING COUNT(*) > 0
    `);
  }
}

async function runIntersect(
  layerIdA: string,
  layerIdB: string,
  newLayerId: string
): Promise<void> {
  await db.execute(sql`
    INSERT INTO features (layer_id, geometry, properties)
    SELECT
      ${newLayerId}::uuid,
      ST_Intersection(a.geometry, b.geometry),
      a.properties
    FROM features a
    CROSS JOIN features b
    WHERE a.layer_id = ${layerIdA}::uuid
      AND b.layer_id = ${layerIdB}::uuid
      AND ST_Intersects(a.geometry, b.geometry)
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

async function runClip(
  layerIdA: string,
  layerIdB: string,
  newLayerId: string
): Promise<void> {
  await db.execute(sql`
    INSERT INTO features (layer_id, geometry, properties)
    SELECT
      ${newLayerId}::uuid,
      ST_Intersection(a.geometry, mask.geom),
      a.properties
    FROM features a
    CROSS JOIN (
      SELECT ST_Union(geometry) AS geom FROM features WHERE layer_id = ${layerIdB}::uuid
    ) mask
    WHERE a.layer_id = ${layerIdA}::uuid
      AND ST_Intersects(a.geometry, mask.geom)
      AND NOT ST_IsEmpty(ST_Intersection(a.geometry, mask.geom))
  `);
}
