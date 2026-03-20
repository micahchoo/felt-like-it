import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess } from '../../../../middleware.js';
import { toErrorResponse } from '../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { toComment } from '$lib/server/api/serializers.js';
import { commentLinks } from '$lib/server/api/links.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ request, url, params }) => {
  const auth = await resolveAuth({ request, url });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId, id } = params;
  try { assertMapAccess(auth, mapId); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  const [row] = await typedExecute<any>(sql`
    SELECT id, map_id, user_id, author_name, body, resolved, created_at, updated_at
    FROM comments
    WHERE id = ${id}::uuid AND map_id = ${mapId}::uuid
  `);

  if (!row) return toErrorResponse('COMMENT_NOT_FOUND');

  return jsonResponse(envelope(toComment(row), {}, commentLinks(mapId, id)));
};
