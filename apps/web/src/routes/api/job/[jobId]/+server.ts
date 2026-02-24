import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, importJobs, maps } from '$lib/server/db/index.js';
import { eq, and } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) {
    error(401, 'Unauthorized');
  }

  const [job] = await db
    .select()
    .from(importJobs)
    .where(eq(importJobs.id, params.jobId));

  if (!job) {
    error(404, 'Job not found');
  }

  // Verify ownership via map
  const [map] = await db
    .select()
    .from(maps)
    .where(and(eq(maps.id, job.mapId), eq(maps.userId, locals.user.id)));

  if (!map) {
    error(403, 'Access denied');
  }

  return json({
    id: job.id,
    status: job.status,
    progress: job.progress,
    layerId: job.layerId,
    errorMessage: job.errorMessage,
    fileName: job.fileName,
  });
};
