import { resolveAuth, envelope, jsonResponse, rateLimit, assertMapAccess, requireScope, stripNullBytes } from '../../../../middleware.js';
import { toErrorResponse } from '../../../../errors.js';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { annotationService } from '$lib/server/annotations/service.js';
import { toAnnotation } from '$lib/server/api/serializers.js';
import { annotationLinks } from '$lib/server/api/links.js';
import { db, users } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import type { RequestHandler } from './$types.js';

export const GET: RequestHandler = async ({ request, url, params, locals }) => {
  const auth = await resolveAuth({ request, url, locals });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { mapId, id } = params;
  try { assertMapAccess(auth, mapId); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  if (auth.userId) {
    try { await requireMapAccess(auth.userId, mapId, 'viewer'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  }

  try {
    const obj = await annotationService.get({
      userId: auth.userId ?? '00000000-0000-0000-0000-000000000000',
      id,
    });
    if (obj.mapId !== mapId) return toErrorResponse('ANNOTATION_NOT_FOUND');
    return jsonResponse(envelope(toAnnotation(obj), {}, annotationLinks(mapId, id)));
  } catch {
    return toErrorResponse('ANNOTATION_NOT_FOUND');
  }
};

export const PATCH: RequestHandler = async ({ request, url, params, locals }) => {
  const auth = await resolveAuth({ request, url, locals });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const { mapId, id } = params;
  try { await requireMapAccess(auth.userId, mapId, 'commenter'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }

  let body: Record<string, unknown>;
  try { body = stripNullBytes(await request.json()) as Record<string, unknown>; } catch { return toErrorResponse('VALIDATION_ERROR', 'Invalid JSON body'); }

  // Get user name for changelog
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));

  // Optimistic concurrency: check If-Match header
  const ifMatch = request.headers.get('if-match');
  let currentVersion: number | undefined;
  if (ifMatch) {
    const expectedVersion = parseInt(ifMatch, 10);
    if (!isNaN(expectedVersion)) {
      try {
        const current = await annotationService.get({ userId: auth.userId, id });
        if (current.mapId !== mapId) return toErrorResponse('ANNOTATION_NOT_FOUND');
        if (current.version !== expectedVersion) {
          return toErrorResponse('VERSION_CONFLICT', `Expected version ${expectedVersion}, found ${current.version}`);
        }
        currentVersion = current.version;
      } catch {
        return toErrorResponse('ANNOTATION_NOT_FOUND');
      }
    }
  }

  // If no If-Match, fetch current version for the update call
  if (currentVersion === undefined) {
    try {
      const current = await annotationService.get({ userId: auth.userId, id });
      // IDOR guard: annotation must belong to the map in the URL
      if (current.mapId !== mapId) return toErrorResponse('ANNOTATION_NOT_FOUND');
      currentVersion = current.version;
    } catch {
      return toErrorResponse('ANNOTATION_NOT_FOUND');
    }
  }

  try {
    // TYPE_DEBT: body is Record<string, unknown>; annotationService validates shape at runtime.
    // Spread only the provided fields; server-side zod validation runs inside update().
    const updated = await annotationService.update({
      userId: auth.userId,
      userName: user?.name ?? 'Unknown',
      id,
      version: currentVersion,
      ...(body.anchor !== undefined ? { anchor: body.anchor as never } : {}),
      ...(body.content !== undefined ? { content: body.content as never } : {}),
    });
    return jsonResponse(envelope(toAnnotation(updated), {}, annotationLinks(mapId, id)));
  } catch {
    return toErrorResponse('ANNOTATION_NOT_FOUND');
  }
};

export const DELETE: RequestHandler = async ({ request, url, params, locals }) => {
  const auth = await resolveAuth({ request, url, locals });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const { mapId, id } = params;
  // DELETE is destructive — require editor role, not just commenter
  try { await requireMapAccess(auth.userId, mapId, 'editor'); } catch { return toErrorResponse('MAP_NOT_FOUND'); }

  // IDOR guard: verify annotation belongs to this map before deleting
  try {
    const obj = await annotationService.get({ userId: auth.userId, id });
    if (obj.mapId !== mapId) return toErrorResponse('ANNOTATION_NOT_FOUND');
  } catch {
    return toErrorResponse('ANNOTATION_NOT_FOUND');
  }

  // Get user name for changelog
  const [user] = await db.select({ name: users.name }).from(users).where(eq(users.id, auth.userId));

  try {
    await annotationService.delete({ userId: auth.userId, userName: user?.name ?? 'Unknown', id });
    return new Response(null, { status: 204 });
  } catch {
    return toErrorResponse('ANNOTATION_NOT_FOUND');
  }
};
