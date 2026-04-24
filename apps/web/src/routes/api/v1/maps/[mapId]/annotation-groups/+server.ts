import { resolveAuth, envelope, jsonResponse, rateLimit, requireScope, stripNullBytes, assertMapAccess } from '../../../middleware.js';
import { toErrorResponse } from '../../../errors.js';
import { annotationGroupsService } from '$lib/server/annotations/groups.js';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { RequestHandler } from './$types.js';

const CreateBody = z
  .object({
    name: z.string().min(1).max(200),
    parentGroupId: z.string().uuid().nullable().optional(),
    visible: z.boolean().optional(),
  })
  .strict();

export const GET: RequestHandler = async ({ request, url, params, locals, getClientAddress }) => {
  const auth = await resolveAuth({ request, url, locals, getClientAddress });
  if (!auth) return toErrorResponse('UNAUTHORIZED');
  const rl = rateLimit(auth);
  if (rl) return rl;

  const { mapId } = params;
  try { assertMapAccess(auth, mapId); } catch { return toErrorResponse('MAP_NOT_FOUND'); }
  if (!auth.userId) return toErrorResponse('UNAUTHORIZED');

  try {
    const groups = await annotationGroupsService.list({ userId: auth.userId, mapId });
    return jsonResponse(envelope(groups));
  } catch (err) {
    if (err instanceof TRPCError) {
      if (err.code === 'FORBIDDEN') return toErrorResponse('FORBIDDEN');
      if (err.code === 'NOT_FOUND') return toErrorResponse('MAP_NOT_FOUND');
    }
    throw err;
  }
};

export const POST: RequestHandler = async ({ request, url, params, locals, getClientAddress }) => {
  const auth = await resolveAuth({ request, url, locals, getClientAddress });
  if (!auth) return toErrorResponse('UNAUTHORIZED');
  const rl = rateLimit(auth);
  if (rl) return rl;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const { mapId } = params;
  let body: unknown;
  try { body = stripNullBytes(await request.json()); } catch { return toErrorResponse('VALIDATION_ERROR', 'Invalid JSON body'); }
  const parsed = CreateBody.safeParse(body);
  if (!parsed.success) return toErrorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message);

  try {
    const group = await annotationGroupsService.create({
      userId: auth.userId,
      mapId,
      name: parsed.data.name,
      ...(parsed.data.parentGroupId !== undefined ? { parentGroupId: parsed.data.parentGroupId } : {}),
      ...(parsed.data.visible !== undefined ? { visible: parsed.data.visible } : {}),
    });
    return jsonResponse(envelope(group), 201);
  } catch (err) {
    if (err instanceof TRPCError) {
      if (err.code === 'FORBIDDEN') return toErrorResponse('FORBIDDEN', err.message);
      if (err.code === 'BAD_REQUEST') return toErrorResponse('VALIDATION_ERROR', err.message);
      if (err.code === 'NOT_FOUND') return toErrorResponse('MAP_NOT_FOUND', err.message);
    }
    throw err;
  }
};
