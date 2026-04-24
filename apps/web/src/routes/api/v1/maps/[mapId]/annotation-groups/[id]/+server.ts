import { resolveAuth, envelope, jsonResponse, rateLimit, requireScope, stripNullBytes } from '../../../../middleware.js';
import { toErrorResponse } from '../../../../errors.js';
import { annotationGroupsService } from '$lib/server/annotations/groups.js';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { RequestHandler } from './$types.js';

const PatchBody = z
  .object({
    name: z.string().min(1).max(200).optional(),
    parentGroupId: z.string().uuid().nullable().optional(),
    ordinal: z.number().int().optional(),
    visible: z.boolean().optional(),
  })
  .strict();

export const PATCH: RequestHandler = async ({ request, url, params, locals, getClientAddress }) => {
  const auth = await resolveAuth({ request, url, locals, getClientAddress });
  if (!auth) return toErrorResponse('UNAUTHORIZED');
  const rl = rateLimit(auth);
  if (rl) return rl;
  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const { id } = params;
  let body: unknown;
  try { body = stripNullBytes(await request.json()); } catch { return toErrorResponse('VALIDATION_ERROR', 'Invalid JSON body'); }
  const parsed = PatchBody.safeParse(body);
  if (!parsed.success) return toErrorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message);

  try {
    const group = await annotationGroupsService.update({
      userId: auth.userId,
      id,
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(('parentGroupId' in parsed.data) ? { parentGroupId: parsed.data.parentGroupId ?? null } : {}),
      ...(parsed.data.ordinal !== undefined ? { ordinal: parsed.data.ordinal } : {}),
      ...(parsed.data.visible !== undefined ? { visible: parsed.data.visible } : {}),
    });
    return jsonResponse(envelope(group));
  } catch (err) {
    if (err instanceof TRPCError) {
      if (err.code === 'NOT_FOUND') return toErrorResponse('ANNOTATION_NOT_FOUND', err.message);
      if (err.code === 'FORBIDDEN') return toErrorResponse('FORBIDDEN', err.message);
      if (err.code === 'BAD_REQUEST') return toErrorResponse('VALIDATION_ERROR', err.message);
    }
    throw err;
  }
};

export const DELETE: RequestHandler = async ({ request, url, params, locals, getClientAddress }) => {
  const auth = await resolveAuth({ request, url, locals, getClientAddress });
  if (!auth) return toErrorResponse('UNAUTHORIZED');
  const rl = rateLimit(auth);
  if (rl) return rl;
  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  try {
    await annotationGroupsService.delete({ userId: auth.userId, id: params.id });
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof TRPCError) {
      if (err.code === 'FORBIDDEN') return toErrorResponse('FORBIDDEN', err.message);
      if (err.code === 'NOT_FOUND') return new Response(null, { status: 204 }); // idempotent
    }
    throw err;
  }
};
