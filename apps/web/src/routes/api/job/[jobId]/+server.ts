import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db, importJobs } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { TRPCError } from '@trpc/server';

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

  // Verify access — owner or editor+ collaborator
  try {
    await requireMapAccess(locals.user.id, job.mapId, 'editor');
  } catch (err) {
    if (err instanceof TRPCError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 500;
      error(status, err.message);
    }
    throw err;
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
