import { sql, eq } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess, requireScope, stripNullBytes } from '../../../middleware.js';
import { toErrorResponse } from '../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { db, comments, users } from '$lib/server/db/index.js';
import { toComment } from '$lib/server/api/serializers.js';
import { commentLinks, listLinks } from '$lib/server/api/links.js';
import { parsePaginationParams, encodeCursor } from '$lib/server/api/pagination.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ request, url, params }) => {
  const auth = await resolveAuth({ request, url });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId } = params;
  try { assertMapAccess(auth, mapId); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  const { cursor, limit } = parsePaginationParams(url);
  const cursorClause = cursor
    ? sql`AND (created_at, id) > (${cursor.createdAt}, ${cursor.id}::uuid)`
    : sql``;

  const rows = await typedExecute<any>(sql`
    SELECT id, map_id, user_id, author_name, body, resolved, created_at, updated_at
    FROM comments
    WHERE map_id = ${mapId}::uuid ${cursorClause}
    ORDER BY created_at ASC, id ASC
    LIMIT ${limit + 1}
  `);

  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasNext && last
    ? encodeCursor(last.created_at, last.id)
    : null;

  const [countRow] = await typedExecute<{ cnt: string }>(sql`
    SELECT COUNT(*)::text AS cnt FROM comments WHERE map_id = ${mapId}::uuid
  `);
  const basePath = `/api/v1/maps/${mapId}/comments`;

  return jsonResponse(envelope(
    items.map(toComment),
    { totalCount: parseInt(countRow.cnt, 10), limit, nextCursor },
    listLinks(basePath, nextCursor),
  ));
};

export const POST: RequestHandler = async ({ request, url, params }) => {
  const auth = await resolveAuth({ request, url });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const { mapId } = params;
  try { await requireMapAccess(auth.userId, mapId, 'commenter'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }

  let body: any;
  try { body = stripNullBytes(await request.json()); } catch { return toErrorResponse('VALIDATION_ERROR', 'Invalid JSON body'); }

  if (!body.body || typeof body.body !== 'string') {
    return toErrorResponse('VALIDATION_ERROR', 'body is required and must be a string');
  }

  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));

  const [created] = await db
    .insert(comments)
    .values({
      mapId,
      userId: auth.userId,
      authorName: user?.name ?? 'Unknown',
      body: body.body,
    })
    .returning();

  return jsonResponse(
    envelope(toComment(created), {}, commentLinks(mapId, created.id)),
    201,
  );
};
