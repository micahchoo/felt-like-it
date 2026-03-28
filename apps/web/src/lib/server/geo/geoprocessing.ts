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
import type { GeoprocessingOp, GeoAggregateOp } from '@felt-like-it/shared-types';

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
  // Guard against unbounded PostGIS operations on large datasets
  await db.execute(sql`SET LOCAL statement_timeout = '30s'`);

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
    case 'point_in_polygon':
      await runPointInPolygon(op.layerIdPoints, op.layerIdPolygons, newLayerId);
      break;
    case 'nearest_neighbor':
      await runNearestNeighbor(op.layerIdA, op.layerIdB, newLayerId);
      break;
    case 'aggregate':
      await runAggregate(op, newLayerId);
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
    case 'nearest_neighbor':
      return [op.layerIdA, op.layerIdB];
    case 'point_in_polygon':
      return [op.layerIdPoints, op.layerIdPolygons];
    case 'aggregate':
      return [op.layerIdPolygons, op.layerIdPoints];
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

/**
 * Spatial join: copy polygon attributes onto each point.
 * Uses a LEFT JOIN so points with no containing polygon are still emitted
 * with their original attributes only. DISTINCT ON (p.id) takes the first
 * matching polygon if a point overlaps multiple polygons.
 */
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

/**
 * Spatial join: for each feature in A find its single nearest neighbor in B
 * and merge B's attributes in. Uses the PostGIS KNN `<->` distance operator
 * with CROSS JOIN LATERAL + LIMIT 1 for index-accelerated lookup.
 */
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

/**
 * Aggregate point statistics per polygon (count / sum / avg).
 * Points are joined to polygons via ST_Within. LEFT JOIN ensures polygons
 * with no points still appear in the output (with 0 count or NULL sum/avg).
 * The result attribute name is `outputField` (or the aggregation type if omitted).
 */
async function runAggregate(op: GeoAggregateOp, newLayerId: string): Promise<void> {
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
    // Router validates field is present before calling runGeoprocessing
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
    // avg — router validates field is present before calling runGeoprocessing
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
