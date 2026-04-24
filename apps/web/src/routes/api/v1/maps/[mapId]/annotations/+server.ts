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
import { depthLimit } from '$lib/server/validation/depth.js';
import { withIdempotency } from '$lib/server/idempotency.js';
import type { RequestHandler } from './$types.js';

/**
 * Cap nested JSON depth on the content field (M2) — annotation content is a
 * jsonb column accepting arbitrary shapes; unbounded nesting is a DoS vector
 * through recursive JSON parsers / serializers downstream. 20 levels is far
 * beyond any legitimate rich-text / GeoJSON structure.
 */
const MAX_CONTENT_DEPTH = 20;
const CreateAnnotationWithDepthLimit = CreateAnnotationObjectSchema.superRefine((value, ctx) => {
  const check = depthLimit(MAX_CONTENT_DEPTH);
  // Run the refinement on the content field specifically so the error path
  // points at the offending field instead of the whole envelope.
  const sub = { ...ctx, addIssue: (issue: Parameters<typeof ctx.addIssue>[0]) => ctx.addIssue({ ...issue, path: ['content', ...(issue.path ?? [])] }) };
  check(value.content, sub as typeof ctx);
});

export const GET: RequestHandler = async ({ request, url, params, locals, getClientAddress }) => {
  const auth = await resolveAuth({ request, url, locals, getClientAddress });
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
  const last = result.items[result.items.length - 1];
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

export const POST: RequestHandler = async (event) => {
  const { request, url, params, locals, getClientAddress } = event;
  return withIdempotency(event, async () => {
    const auth = await resolveAuth({ request, url, locals, getClientAddress });
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
    const parsed = CreateAnnotationWithDepthLimit.safeParse({ ...(body as Record<string, unknown>), mapId });
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
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
      });

      return jsonResponse(
        envelope(toAnnotation(created), {}, annotationLinks(mapId, created.id)),
        201,
      );
    } catch (e: unknown) {
      if (e && typeof e === 'object' && 'code' in e) {
        const code = (e as { code: string }).code;
        const message = e instanceof Error ? e.message : '';
        if (code === 'PRECONDITION_FAILED' || message.includes('Maximum')) {
          return toErrorResponse('LIMIT_EXCEEDED', 'Annotation limit reached for this map');
        }
        if (code === 'NOT_FOUND' || code === '23503' || message.includes('foreign key') || message.includes('not found') || message.includes('violates')) {
          return toErrorResponse('VALIDATION_ERROR', 'Invalid parentId: referenced annotation does not exist');
        }
      }
      if (e instanceof Error) {
        if (e.message.includes('Maximum')) {
          return toErrorResponse('LIMIT_EXCEEDED', 'Annotation limit reached for this map');
        }
        if (e.message.includes('foreign key') || e.message.includes('not found') || e.message.includes('violates')) {
          return toErrorResponse('VALIDATION_ERROR', 'Invalid parentId: referenced annotation does not exist');
        }
      }
      throw e;
    }
  });
};
