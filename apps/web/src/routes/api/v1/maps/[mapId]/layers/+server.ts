import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../../middleware.js';
import { toErrorResponse } from '../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { toLayerSummary } from '$lib/server/api/serializers.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ request, url, params }) => {
  const auth = await resolveAuth({ request, url } as any);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId } = params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  const rows = await typedExecute<any>(sql`
    SELECT l.id, l.map_id, l.name, l.type, l.visible, l.z_index,
      (SELECT COUNT(*)::int FROM features f WHERE f.layer_id = l.id) AS feature_count
    FROM layers l
    WHERE l.map_id = ${mapId}::uuid
    ORDER BY l.z_index ASC
  `);

  return jsonResponse(envelope(
    rows.map(toLayerSummary),
    { totalCount: rows.length, limit: rows.length, nextCursor: null },
    { self: `/api/v1/maps/${mapId}/layers`, map: `/api/v1/maps/${mapId}` },
  ));
};
