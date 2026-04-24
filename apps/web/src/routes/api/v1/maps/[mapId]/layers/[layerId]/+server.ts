import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../../../middleware.js';
import { toErrorResponse } from '../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { toLayerDetail } from '$lib/server/api/serializers.js';
import { layerLinks } from '$lib/server/api/links.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

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

  const [row] = await typedExecute<Record<string, unknown>>(sql`
    SELECT l.id, l.map_id, l.name, l.type, l.style, l.visible, l.z_index, l.source_file_name,
      (SELECT COUNT(*)::int FROM features f WHERE f.layer_id = l.id) AS feature_count
    FROM layers l
    WHERE l.id = ${layerId}::uuid AND l.map_id = ${mapId}::uuid
  `);

  if (!row) return toErrorResponse('LAYER_NOT_FOUND');

  return jsonResponse(envelope(toLayerDetail(row), {}, layerLinks(mapId, layerId)));
};
