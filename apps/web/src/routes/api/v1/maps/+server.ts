import { sql } from 'drizzle-orm';
import { resolveAuth, envelope, jsonResponse, rateLimit } from '../middleware.js';
import { toErrorResponse } from '../errors.js';
import { toMapSummary } from '$lib/server/api/serializers.js';
import { listLinks } from '$lib/server/api/links.js';
import { parsePaginationParams, encodeCursor } from '$lib/server/api/pagination.js';
import { typedExecute } from '$lib/server/geo/queries.js';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ request, url, locals, getClientAddress }) => {
  const auth = await resolveAuth({ request, url, locals, getClientAddress });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  // Share tokens can only access their specific map
  if (auth.mapScope) {
    const rows = await typedExecute<Record<string, unknown>>(sql`
      SELECT id, title, description, basemap, created_at, updated_at
      FROM maps WHERE id = ${auth.mapScope}::uuid
    `);
    return jsonResponse(envelope(
      rows.map(toMapSummary),
      { totalCount: rows.length, limit: rows.length, nextCursor: null },
      { self: '/api/v1/maps' },
    ));
  }

  const { cursor, limit } = parsePaginationParams(url);

  const cursorClause = cursor
    ? sql`AND (m.created_at, m.id) > (${cursor.createdAt}, ${cursor.id}::uuid)`
    : sql``;

  type MapListRow = {
    id: string;
    title: string;
    description: string | null;
    basemap: string;
    created_at: string | Date;
    updated_at: string | Date;
  };
  const rows = await typedExecute<MapListRow>(sql`
    SELECT m.id, m.title, m.description, m.basemap, m.created_at, m.updated_at
    FROM maps m
    LEFT JOIN map_collaborators mc ON mc.map_id = m.id AND mc.user_id = ${auth.userId}::uuid
    WHERE (m.user_id = ${auth.userId}::uuid OR mc.user_id IS NOT NULL)
      ${cursorClause}
    ORDER BY m.created_at ASC, m.id ASC
    LIMIT ${limit + 1}
  `);

  const hasNext = rows.length > limit;
  const items = hasNext ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  const nextCursor = hasNext && last
    ? encodeCursor(last.created_at, last.id)
    : null;

  const [countRow] = await typedExecute<{ cnt: string }>(sql`
    SELECT COUNT(*)::text AS cnt FROM maps m
    LEFT JOIN map_collaborators mc ON mc.map_id = m.id AND mc.user_id = ${auth.userId}::uuid
    WHERE (m.user_id = ${auth.userId}::uuid OR mc.user_id IS NOT NULL)
  `);

  return jsonResponse(envelope(
    items.map(toMapSummary),
    { totalCount: parseInt(countRow?.cnt ?? '0', 10), limit, nextCursor },
    listLinks('/api/v1/maps', nextCursor),
  ));
};
