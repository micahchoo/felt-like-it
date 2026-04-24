import { resolveAuth, envelope, jsonResponse, rateLimit, requireScope, stripNullBytes } from '../../../middleware.js';
import { toErrorResponse } from '../../../errors.js';
import { convertAnnotationsToLayer } from '$lib/server/annotations/convert.js';
import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import type { RequestHandler } from './$types.js';

const BodySchema = z
  .object({
    annotationIds: z.array(z.string().uuid()).min(1).max(500),
    layerName: z.string().min(1).max(200),
  })
  .strict();

export const POST: RequestHandler = async ({ request, url, params, locals, getClientAddress }) => {
  const auth = await resolveAuth({ request, url, locals, getClientAddress });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const { mapId } = params;

  let body: unknown;
  try { body = stripNullBytes(await request.json()); } catch { return toErrorResponse('VALIDATION_ERROR', 'Invalid JSON body'); }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return toErrorResponse('VALIDATION_ERROR', parsed.error.issues[0]?.message);

  try {
    const result = await convertAnnotationsToLayer({
      userId: auth.userId,
      mapId,
      annotationIds: parsed.data.annotationIds,
      layerName: parsed.data.layerName,
    });
    return jsonResponse(envelope(result), 201);
  } catch (err) {
    if (err instanceof TRPCError) {
      const code = err.code;
      if (code === 'NOT_FOUND') return toErrorResponse('ANNOTATION_NOT_FOUND', err.message);
      if (code === 'BAD_REQUEST') return toErrorResponse('VALIDATION_ERROR', err.message);
      if (code === 'PAYLOAD_TOO_LARGE') return toErrorResponse('VALIDATION_ERROR', err.message);
      if (code === 'FORBIDDEN') return toErrorResponse('FORBIDDEN', err.message);
    }
    throw err;
  }
};
