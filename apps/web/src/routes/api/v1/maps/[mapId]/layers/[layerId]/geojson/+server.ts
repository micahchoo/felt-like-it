import { sql } from 'drizzle-orm';
import { resolveAuth, rateLimit, assertMapAccess } from '../../../../../middleware.js';
import { toErrorResponse } from '../../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import { cacheKey, getCachedGeoJSON, setCachedGeoJSON } from '$lib/server/api/geojson-cache.js';
import type { RequestHandler } from './$types.js';

const DEFAULT_LIMIT = 5_000;
const MAX_LIMIT = 50_000;

export const GET: RequestHandler = async ({ request, url, params, locals, getClientAddress }) => {
  const auth = await resolveAuth({ request, url, locals, getClientAddress });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId, layerId } = params;
  try { assertMapAccess(auth, mapId); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  // Verify layer belongs to map
  const [layer] = await typedExecute<Record<string, unknown>>(sql`
    SELECT id FROM layers WHERE id = ${layerId}::uuid AND map_id = ${mapId}::uuid
  `);
  if (!layer) return toErrorResponse('LAYER_NOT_FOUND');

  // Parse optional filters
  const bbox = url.searchParams.get('bbox');
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get('limit') ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT,
  );

  // Check ETag cache
  const key = cacheKey(layerId, bbox, limit);
  const cached = getCachedGeoJSON(key);

  if (cached) {
    const ifNoneMatch = request.headers.get('if-none-match');
    if (ifNoneMatch === `"${cached.etag}"`) {
      return new Response(null, { status: 304 });
    }
    return new Response(cached.body, {
      headers: {
        'Content-Type': 'application/geo+json',
        'ETag': `"${cached.etag}"`,
        'Cache-Control': 'private, max-age=10',
      },
    });
  }

  // Get total count for X-Total-Features header
  const bboxClause = bbox
    ? (() => {
        const [xmin, ymin, xmax, ymax] = bbox.split(',').map(Number);
        if ([xmin, ymin, xmax, ymax].some((v) => isNaN(v as number))) return sql``;
        return sql`AND ST_Intersects(geometry, ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}, 4326))`;
      })()
    : sql``;

  const [countRow] = await typedExecute<{ cnt: string }>(sql`
    SELECT COUNT(*)::text AS cnt FROM features
    WHERE layer_id = ${layerId}::uuid ${bboxClause}
  `);
  const totalFeatures = parseInt(countRow?.cnt ?? '0', 10);

  const rows = await typedExecute<Record<string, unknown>>(sql`
    SELECT id, ST_AsGeoJSON(geometry)::json AS geometry, properties
    FROM features
    WHERE layer_id = ${layerId}::uuid ${bboxClause}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `);

  // Always buffer + cache (the DB query is the bottleneck, not serialization)
  const body = JSON.stringify({
    type: 'FeatureCollection',
    features: rows.map((r: Record<string, unknown>) => ({
      type: 'Feature',
      id: r.id,
      geometry: r.geometry,
      properties: r.properties,
    })),
  });

  const etag = setCachedGeoJSON(key, body);

  return new Response(body, {
    headers: {
      'Content-Type': 'application/geo+json',
      'X-Total-Features': String(totalFeatures),
      'ETag': `"${etag}"`,
      'Cache-Control': 'private, max-age=10',
    },
  });
};
