import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess, requireScope } from '../../../middleware.js';
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
  const auth = await resolveAuth({ request, url } as any);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId } = params;
  assertMapAccess(auth, mapId);
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  const rootsOnly = url.searchParams.get('rootsOnly') === 'true';
  const { cursor, limit } = parsePaginationParams(url);

  // For share token auth (no userId), use a nil UUID for the access check
  const result = await annotationService.list({
    userId: auth.userId ?? '00000000-0000-0000-0000-000000000000',
    mapId,
    rootsOnly,
    cursor: cursor ?? undefined,
    limit,
  });

  const items = result.items.map(toAnnotation);
  const nextCursor = items.length === limit && items.length > 0
    ? encodeCursor(items[items.length - 1].createdAt, items[items.length - 1].id)
    : null;
  const basePath = `/api/v1/maps/${mapId}/annotations`;

  return jsonResponse(envelope(
    items,
    { totalCount: result.totalCount, limit, nextCursor },
    listLinks(basePath, nextCursor),
  ));
};

export const POST: RequestHandler = async ({ request, url, params }) => {
  const auth = await resolveAuth({ request, url } as any);
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const { mapId } = params;
  try { await requireMapAccess(auth.userId, mapId, 'commenter'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }

  let body: unknown;
  try { body = await request.json(); } catch { return toErrorResponse('VALIDATION_ERROR', 'Invalid JSON body'); }

  const parsed = CreateAnnotationObjectSchema.safeParse({ ...(body as any), mapId });
  if (!parsed.success) return toErrorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message);

  // Get user name for denormalized authorName
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));

  try {
    const created = await annotationService.create({
      userId: auth.userId,
      userName: user?.name ?? 'Unknown',
      mapId,
      parentId: parsed.data.parentId,
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
    throw e;
  }
};
