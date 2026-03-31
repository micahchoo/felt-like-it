/* eslint-disable no-undef, @typescript-eslint/no-explicit-any */
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ request, url }) => {
  const jobId = url.searchParams.get('jobId');
  if (!jobId) {
    error(400, 'Missing jobId parameter');
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const cleanup = () => {
        if (interval) clearInterval(interval);
      };

      const abortHandler = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // Already closed
        }
      };

      // Close when client disconnects
      request.signal.addEventListener('abort', abortHandler, { once: true });

      let interval: ReturnType<typeof setInterval> | undefined;

      try {
        // Poll the import_jobs table for status updates
        interval = setInterval(async () => {
          try {
            const result = await db.execute(
              sql`SELECT status, progress, error_message, layer_id FROM import_jobs WHERE id = ${jobId}`
            );
            const row = (result as any).rows?.[0];
            if (!row) {
              send({ type: 'error', message: 'Job not found' });
              cleanup();
              controller.close();
              return;
            }

            const eventType =
              row.status === 'done' ? 'complete' : row.status === 'failed' ? 'error' : 'progress';

            send({
              type: eventType,
              progress: row.progress ?? 0,
              message: row.error_message ?? undefined,
              layerId: row.layer_id ?? undefined,
            });

            if (row.status === 'done' || row.status === 'failed') {
              cleanup();
              controller.close();
            }
          } catch (err) {
            send({ type: 'error', message: (err as Error).message });
            cleanup();
            controller.close();
          }
        }, 1000);
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
        cleanup();
        controller.close();
      }
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
