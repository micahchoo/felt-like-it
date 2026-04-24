/* global ReadableStream, TextEncoder */
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { importJobs, maps } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * SSE endpoint for export job progress.
 * GET /api/v1/export/progress?jobId=<jobId>
 *
 * Streams progress updates for async export jobs.
 * Reuses the same pattern as import progress (F02).
 */
export const GET: RequestHandler = async ({ url, locals, request }) => {
  if (!locals.user) {
    throw error(401, 'Unauthorized');
  }
  const user = locals.user;

  const jobId = url.searchParams.get('jobId');
  if (!jobId) {
    throw error(400, 'Missing jobId parameter');
  }

  // Verify job exists and user has access (joined query — Drizzle relations not declared)
  const [row] = await db
    .select({
      status: importJobs.status,
      progress: importJobs.progress,
      errorMessage: importJobs.errorMessage,
      ownerId: maps.userId,
    })
    .from(importJobs)
    .innerJoin(maps, eq(importJobs.mapId, maps.id))
    .where(eq(importJobs.id, jobId))
    .limit(1);

  if (!row) {
    throw error(404, 'Export job not found');
  }

  if (row.ownerId !== user.id) {
    throw error(403, 'Access denied');
  }

  const job = row;

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Send initial state
      const sendEvent = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Send current status immediately
      sendEvent('progress', {
        jobId,
        status: job.status,
        progress: job.progress,
        error: job.errorMessage,
      });

      // Poll for updates every second
      const interval = setInterval(async () => {
        try {
          const updated = await db.query.importJobs.findFirst({
            where: eq(importJobs.id, jobId),
          });

          if (!updated) {
            sendEvent('error', { jobId, error: 'Job not found' });
            clearInterval(interval);
            controller.close();
            return;
          }

          sendEvent('progress', {
            jobId,
            status: updated.status,
            progress: updated.progress,
            error: updated.errorMessage,
          });

          // Close stream when job is done or failed
          if (updated.status === 'done' || updated.status === 'failed') {
            clearInterval(interval);
            controller.close();
          }
        } catch (err) {
          sendEvent('error', { jobId, error: 'Polling failed' });
          clearInterval(interval);
          controller.close();
        }
      }, 1000);

      // Cleanup on client disconnect
      request.signal.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
