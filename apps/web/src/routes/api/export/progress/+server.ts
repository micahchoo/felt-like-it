import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { importJobs } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';

/**
 * SSE endpoint for export job progress.
 * GET /api/export/progress?jobId=<jobId>
 *
 * Streams progress updates for async export jobs.
 * Reuses the same pattern as import progress (F02).
 */
export const GET: RequestHandler = async ({ url, locals, request }) => {
  if (!locals.user) {
    error(401, 'Unauthorized');
  }

  const jobId = url.searchParams.get('jobId');
  if (!jobId) {
    error(400, 'Missing jobId parameter');
  }

  // Verify job exists and user has access
  const job = await db.query.importJobs.findFirst({
    where: eq(importJobs.id, jobId),
    with: { map: true },
  });

  if (!job) {
    error(404, 'Export job not found');
  }

  if (job.map.ownerId !== locals.user.id) {
    error(403, 'Access denied');
  }

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
