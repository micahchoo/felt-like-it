import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../middleware.js';
import { toErrorResponse } from '../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { toMapDetail } from '$lib/server/api/serializers.js';
import { mapLinks } from '$lib/server/api/links.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ request, url, params }) => {
  const auth = await resolveAuth({ request, url });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId } = params;
  try { assertMapAccess(auth, mapId); } catch { return toErrorResponse('MAP_NOT_FOUND'); }

  // For API key auth, verify access via requireMapAccess
  if (auth.userId) {
    try {
      await requireMapAccess(auth.userId, mapId, 'viewer');
    } catch {
      return toErrorResponse('MAP_NOT_FOUND');
    }
  }

  const [row] = await typedExecute<Record<string, unknown>>(sql`
    SELECT id, title, description, viewport, basemap, created_at, updated_at
    FROM maps WHERE id = ${mapId}::uuid
  `);

  if (!row) return toErrorResponse('MAP_NOT_FOUND');

  return jsonResponse(envelope(toMapDetail(row), {}, mapLinks(mapId)));
};
