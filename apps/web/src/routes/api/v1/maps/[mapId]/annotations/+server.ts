import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess, requireScope, stripNullBytes } from '../../../middleware.js';
import { toErrorResponse } from '../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { annotationService } from '$lib/server/annotations/service.js';
import { toAnnotation } from '$lib/server/api/serializers.js';
import { annotationLinks, listLinks } from '$lib/server/api/links.js';
import { parsePaginationParams, encodeCursor } from '$lib/server/api/pagination.js';
import { CreateAnnotationObjectSchema } from '@felt-like-it/shared-types';
import { db, users } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
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

  const rootsOnly = url.searchParams.get('rootsOnly') === 'true';
  const { cursor, limit } = parsePaginationParams(url);

  const result = await annotationService.list({
    userId: auth.userId,
    mapId,
    rootsOnly,
    ...(cursor !== null ? { cursor } : {}),
    limit,
  });

  const items = result.items.map(toAnnotation);
  const last = items[items.length - 1];
  const nextCursor = items.length === limit && last
    ? encodeCursor(last.createdAt, last.id)
    : null;
  const basePath = `/api/v1/maps/${mapId}/annotations`;

  return jsonResponse(envelope(
    items,
    { totalCount: result.totalCount, limit, nextCursor },
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

  let body: unknown;
  try { body = stripNullBytes(await request.json()); } catch { return toErrorResponse('VALIDATION_ERROR', 'Invalid JSON body'); }

  // TYPE_DEBT: body is validated by Zod immediately; cast needed to spread unknown
  const parsed = CreateAnnotationObjectSchema.safeParse({ ...(body as Record<string, unknown>), mapId });
  if (!parsed.success) return toErrorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message);

  // Get user name for denormalized authorName
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));

  try {
    const created = await annotationService.create({
      userId: auth.userId,
      userName: user?.name ?? 'Unknown',
      mapId,
      ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId } : {}),
      anchor: parsed.data.anchor,
      content: parsed.data.content,
    });

    return jsonResponse(
      envelope(toAnnotation(created), {}, annotationLinks(mapId, created.id)),
      201,
    );
  } catch (e: any) {
    if (e.code === 'PRECONDITION_FAILED' || e.message?.includes('Maximum')) {
      return toErrorResponse('LIMIT_EXCEEDED', 'Annotation limit reached for this map');
    }
    // FK violation (invalid parentId) or NOT_FOUND from service
    if (e.code === 'NOT_FOUND' || e.code === '23503' || e.message?.includes('foreign key') || e.message?.includes('not found') || e.message?.includes('violates')) {
      return toErrorResponse('VALIDATION_ERROR', 'Invalid parentId: referenced annotation does not exist');
    }
    throw e;
  }
};
