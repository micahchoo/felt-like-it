import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { env } from '$env/dynamic/private';
import { db, importJobs, maps } from '$lib/server/db/index.js';
import { mapCollaborators } from '$lib/server/db/schema.js';
import { eq, and } from 'drizzle-orm';
import { enqueueImportJob } from '$lib/server/jobs/queues.js';
import { randomUUID } from 'crypto';

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

  if (file.size > MAX_FILE_SIZE) {
    error(413, `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB`);
  }

  // Verify map access (owner or editor collaborator)
  const [map] = await db
    .select({ id: maps.id, userId: maps.userId })
    .from(maps)
    .where(eq(maps.id, mapId));

  if (!map) {
    error(404, 'Map not found');
  }

  if (map.userId !== locals.user.id) {
    const [collab] = await db
      .select({ role: mapCollaborators.role })
      .from(mapCollaborators)
      .where(and(
        eq(mapCollaborators.mapId, mapId),
        eq(mapCollaborators.userId, locals.user.id),
      ));

    if (!collab || collab.role === 'viewer' || collab.role === 'commenter') {
      error(404, 'Map not found');
    }
  }

  // Create job ID and save file to disk
  const jobId = randomUUID();
  const jobDir = join(UPLOAD_DIR, jobId);
  await mkdir(jobDir, { recursive: true });

  const filePath = join(jobDir, file.name);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);

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
