import { readFile, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import { resolveAuth, rateLimit } from '../../middleware.js';
import { toErrorResponse } from '../../errors.js';
import type { RequestHandler } from './$types.js';

const MIME_MAP: Record<string, string> = {
  json: 'application/json',
  geojson: 'application/geo+json',
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
};

export const GET: RequestHandler = async ({ request, url, params, locals }) => {
  const auth = await resolveAuth({ request, url, locals });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  const { id } = params;
  const uploadDir = env.UPLOAD_DIR ?? './uploads/api';

  // Find file by ID prefix (id.ext)
  let files: string[];
  try { files = await readdir(uploadDir); } catch { return toErrorResponse('FILE_NOT_FOUND'); }

  const match = files.find((f) => f.startsWith(id));
  if (!match) return toErrorResponse('FILE_NOT_FOUND');

  // Path traversal defense
  const filePath = resolve(join(uploadDir, match));
  if (!filePath.startsWith(resolve(uploadDir))) {
    return toErrorResponse('FILE_NOT_FOUND');
  }

  const ext = match.split('.').pop() ?? 'bin';
  const contentType = MIME_MAP[ext] ?? 'application/octet-stream';

  const buffer = await readFile(filePath);
  return new Response(buffer, {
    headers: { 'Content-Type': contentType, 'Cache-Control': 'public, max-age=31536000, immutable' },
  });
};
