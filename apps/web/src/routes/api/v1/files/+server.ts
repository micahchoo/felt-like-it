import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { env } from '$env/dynamic/private';
import { resolveAuth, envelope, jsonResponse, rateLimit, requireScope } from '../middleware.js';
import { toErrorResponse } from '../errors.js';
import type { RequestHandler } from './$types.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export const POST: RequestHandler = async ({ request, url }) => {
  const auth = await resolveAuth({ request, url });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  try { requireScope(auth, 'read-write'); } catch { return toErrorResponse('FORBIDDEN'); }
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('multipart/form-data')) {
    return toErrorResponse('VALIDATION_ERROR', 'Content-Type must be multipart/form-data');
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return toErrorResponse('VALIDATION_ERROR', 'file field is required');
  if (file.size > MAX_FILE_SIZE) return toErrorResponse('VALIDATION_ERROR', 'File exceeds 50MB limit');

  const uploadDir = env.UPLOAD_DIR ?? './uploads/api';
  const id = randomUUID();
  const ext = file.name.split('.').pop() ?? 'bin';
  const storedName = `${id}.${ext}`;

  await mkdir(uploadDir, { recursive: true });

  // Path traversal defense: verify resolved path is within target directory
  const targetPath = resolve(join(uploadDir, storedName));
  if (!targetPath.startsWith(resolve(uploadDir))) {
    return toErrorResponse('VALIDATION_ERROR', 'Invalid file name');
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(targetPath, buffer);

  const publicUrl = `/api/v1/files/${id}`;

  return jsonResponse(
    envelope(
      { id, fileName: file.name, fileSize: file.size, url: publicUrl },
      {},
      { self: publicUrl },
    ),
    201,
  );
};
