import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../../../../middleware.js';
import { toErrorResponse } from '../../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { toFeatureSummary } from '$lib/server/api/serializers.js';
import { listLinks } from '$lib/server/api/links.js';
import { parsePaginationParams, encodeCursor } from '$lib/server/api/pagination.js';
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

  // Verify layer on map
  const [layer] = await typedExecute<any>(sql`
    SELECT id, (SELECT COUNT(*)::int FROM features WHERE layer_id = ${layerId}::uuid) AS feature_count
    FROM layers WHERE id = ${layerId}::uuid AND map_id = ${mapId}::uuid
  `);
  if (!layer) return toErrorResponse('LAYER_NOT_FOUND');

  const { cursor, limit } = parsePaginationParams(url);
  const cursorClause = cursor
    ? sql`AND (created_at, id) > (${cursor.createdAt}, ${cursor.id}::uuid)`
    : sql``;

  const rows = await typedExecute<any>(sql`
    SELECT id, properties, GeometryType(geometry) AS geometry_type, created_at
    FROM features
    WHERE layer_id = ${layerId}::uuid ${cursorClause}
    ORDER BY created_at ASC, id ASC
    LIMIT ${limit + 1}
  `);

  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasNext && last
    ? encodeCursor(last.created_at, last.id)
    : null;
  const basePath = `/api/v1/maps/${mapId}/layers/${layerId}/features`;

  return jsonResponse(envelope(
    items.map(toFeatureSummary),
    { totalCount: layer.feature_count, limit, nextCursor },
    { ...listLinks(basePath, nextCursor), geojson: `/api/v1/maps/${mapId}/layers/${layerId}/geojson` },
  ));
};
