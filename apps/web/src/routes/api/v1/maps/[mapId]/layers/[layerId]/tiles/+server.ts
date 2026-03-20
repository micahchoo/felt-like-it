import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/public';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../../../../middleware.js';
import { toErrorResponse } from '../../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ request, url, params }) => {
  const auth = await resolveAuth({ request, url } as any);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId, layerId } = params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  // Verify layer exists on this map
  const [layer] = await typedExecute<any>(sql`
    SELECT id FROM layers WHERE id = ${layerId}::uuid AND map_id = ${mapId}::uuid
  `);
  if (!layer) return toErrorResponse('LAYER_NOT_FOUND');

  // Get bounds from PostGIS
  const [bounds] = await typedExecute<any>(sql`
    SELECT
      ST_XMin(ext)::float AS xmin, ST_YMin(ext)::float AS ymin,
      ST_XMax(ext)::float AS xmax, ST_YMax(ext)::float AS ymax
    FROM (SELECT ST_Extent(geometry) AS ext FROM features WHERE layer_id = ${layerId}::uuid) sub
  `);

  const martinUrl = env.PUBLIC_MARTIN_URL ?? 'http://localhost:3001';

  return jsonResponse(envelope(
    {
      tilejson: '3.0.0',
      tileUrl: `${martinUrl}/function_zxy_query/{z}/{x}/{y}?layer_id=${layerId}`,
      minzoom: 0,
      maxzoom: 14,
      bounds: bounds?.xmin != null ? [bounds.xmin, bounds.ymin, bounds.xmax, bounds.ymax] : null,
    },
    {},
    { layer: `/api/v1/maps/${mapId}/layers/${layerId}` },
  ));
};
