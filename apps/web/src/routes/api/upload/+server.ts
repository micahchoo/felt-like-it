import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mkdir, writeFile } from 'fs/promises';
import { createWriteStream, WriteStream } from 'fs';
import { join } from 'path';
import { sanitizeFilename } from '$lib/server/import/sanitize.js';
import { env } from '$env/dynamic/private';
import { db, importJobs } from '$lib/server/db/index.js';
import { enqueueImportJob } from '$lib/server/jobs/queues.js';
import { randomUUID } from 'crypto';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { TRPCError } from '@trpc/server';

const UPLOAD_DIR = env.UPLOAD_DIR ?? '/tmp/felt-uploads';
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) {
    error(401, 'Unauthorized');
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const mapId = formData.get('mapId') as string | null;
  const layerName = (formData.get('layerName') as string | null) ?? 'Imported Layer';

  if (!file || !mapId) {
    error(400, 'Missing file or mapId');
  }

  // Verify map access — reuse the canonical access helper
  try {
    await requireMapAccess(locals.user.id, mapId, 'editor');
  } catch (err) {
    if (err instanceof TRPCError) {
      // Map TRPCError codes to SvelteKit error codes
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 500;
      error(status, err.message);
    }
    throw err;
  }

  // Create job ID and save file to disk
  const jobId = randomUUID();
  const jobDir = join(UPLOAD_DIR, jobId);
  await mkdir(jobDir, { recursive: true });

  const safeName = sanitizeFilename(file.name);
  const filePath = join(jobDir, safeName);
  // Verify resolved path is within jobDir (defense in depth)
  if (!filePath.startsWith(jobDir)) {
    error(400, 'Invalid filename');
  }

  // Stream file to disk with size enforcement
  const stream = file.stream();
  const reader = stream.getReader();
  const writeStream = createWriteStream(filePath);

  try {
    let bytesWritten = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesWritten += value.length;
      if (bytesWritten > MAX_FILE_SIZE) {
        // Clean up partial file
        writeStream.close();
        error(413, `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB`);
      }
      writeStream.write(value);
    }
  } catch (err) {
    writeStream.close();
    throw err;
  } finally {
    // Ensure stream is closed even on error
    writeStream.end();
    await new Promise<void>((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });
  }

  // Create import job record
  await db.insert(importJobs).values({
    id: jobId,
    mapId,
    status: 'pending',
    fileName: file.name,
    fileSize: file.size,
    progress: 0,
  });

  // Enqueue BullMQ job
  await enqueueImportJob({
    jobId,
    mapId,
    layerName: layerName.trim() || file.name.replace(/\.[^.]+$/, ''),
    filePath,
    fileName: file.name,
  });

  return json({ jobId });
};
