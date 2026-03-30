import { randomUUID } from 'crypto';
import { writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { sql } from 'drizzle-orm';
import { env } from '$env/dynamic/private';
import { db, userUploads } from '$lib/server/db/index.js';
import { resolveAuth, envelope, jsonResponse, rateLimit, requireScope } from '../middleware.js';
import { toErrorResponse } from '../errors.js';
import type { RequestHandler } from './$types.js';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_USER_QUOTA = 500 * 1024 * 1024; // 500MB total per user

export const POST: RequestHandler = async ({ request, url, locals }) => {
  const auth = await resolveAuth({ request, url, locals });
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

  // ── Per-user quota check ────────────────────────────────────────────────────
  const [usage] = await db
    .select({ totalBytes: sql<number>`coalesce(sum(${userUploads.fileSize}), 0)` })
    .from(userUploads)
    .where(sql`${userUploads.userId} = ${auth.userId}`);

  const currentUsage = Number(usage?.totalBytes ?? 0);
  if (currentUsage + file.size > MAX_USER_QUOTA) {
    const usedMB = Math.round(currentUsage / 1024 / 1024);
    const quotaMB = Math.round(MAX_USER_QUOTA / 1024 / 1024);
    return toErrorResponse(
      'QUOTA_EXCEEDED',
      `Upload would exceed your ${quotaMB}MB quota (${usedMB}MB used)`,
    );
  }

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

  // ── Track upload for quota + cleanup ──────────────────────────────────────
  await db.insert(userUploads).values({
    userId: auth.userId,
    fileId: id,
    fileName: file.name,
    fileSize: file.size,
    storedPath: targetPath,
  });

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
