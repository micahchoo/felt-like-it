import { sql } from 'drizzle-orm';
import { resolveAuth, rateLimit, assertMapAccess } from '../../../../../middleware.js';
import { toErrorResponse } from '../../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ request, url, params }) => {
  const auth = await resolveAuth({ request, url });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId, layerId } = params;
  try { assertMapAccess(auth, mapId); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  // Verify layer belongs to map
  const [layer] = await typedExecute<any>(sql`
    SELECT id FROM layers WHERE id = ${layerId}::uuid AND map_id = ${mapId}::uuid
  `);
  if (!layer) return toErrorResponse('LAYER_NOT_FOUND');

  // Parse optional filters
  const bbox = url.searchParams.get('bbox');
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50000', 10), 50000);

  const bboxClause = bbox
    ? (() => {
        const [xmin, ymin, xmax, ymax] = bbox.split(',').map(Number);
        if ([xmin, ymin, xmax, ymax].some(isNaN)) return sql``;
        return sql`AND ST_Intersects(geometry, ST_MakeEnvelope(${xmin}, ${ymin}, ${xmax}, ${ymax}, 4326))`;
      })()
    : sql``;

  const rows = await typedExecute<any>(sql`
    SELECT id, ST_AsGeoJSON(geometry)::json AS geometry, properties
    FROM features
    WHERE layer_id = ${layerId}::uuid ${bboxClause}
    ORDER BY created_at ASC
    LIMIT ${limit}
  `);

  const featureCollection = {
    type: 'FeatureCollection',
    features: rows.map((r: any) => ({
      type: 'Feature',
      id: r.id,
      geometry: r.geometry,
      properties: r.properties,
    })),
  };

  return new Response(JSON.stringify(featureCollection), {
    headers: { 'Content-Type': 'application/geo+json' },
  });
};
