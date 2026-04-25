/* global ReadableStream, TextEncoder */
import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db/index.js';
import { importJobs, maps } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { resolveAuth } from '../../middleware.js';
import { toErrorResponse } from '../../errors.js';

/**
 * H4: Per-user concurrent SSE stream cap.
 *
 * Keyed by userId. Each open stream registers an AbortController in the set
 * at request-start (before any DB work) so the CAP fires even when the job
 * lookup would 404 — that's the attack model (alice opens N streams for
 * non-existent jobIds, each burns a connection + polling interval).
 *
 * Lifecycle invariants (must not leak entries, or the user becomes
 * permanently capped):
 *   1. Add to set ONLY after the CAP check passes.
 *   2. If auth or ownership checks throw after adding, remove in catch.
 *   3. On normal stream close (job done/failed/not-found), remove.
 *   4. On client abort, remove.
 *   5. On idle timeout, close + remove.
 *
 * CAP default 5; overridable via env for tests. Idle timeout 5 min caps
 * zombie streams when a client connects and never aborts.
 */
const STREAM_CAP = parseInt(env.EXPORT_SSE_STREAM_CAP ?? '5', 10);
const IDLE_TIMEOUT_MS = parseInt(env.EXPORT_SSE_IDLE_MS ?? '300000', 10); // 5 min

const activeStreams = new Map<string, Set<AbortController>>();

function registerStream(userId: string): AbortController | null {
  let set = activeStreams.get(userId);
  if (!set) {
    set = new Set<AbortController>();
    activeStreams.set(userId, set);
  }
  if (set.size >= STREAM_CAP) return null;
  const controller = new AbortController();
  set.add(controller);
  return controller;
}

function releaseStream(userId: string, controller: AbortController): void {
  const set = activeStreams.get(userId);
  if (!set) return;
  set.delete(controller);
  if (set.size === 0) activeStreams.delete(userId);
}

/**
 * Deferred release for non-stream error paths (401/403/404 thrown before
 * the ReadableStream is returned). Without the deferral, an attacker
 * hammering this endpoint with bogus jobIds serializes through the dev
 * server: each request registers, awaits DB for ~5 ms, releases, throws
 * 404. The cap never trips because slots are freed faster than the next
 * request arrives. A short hold window (default 500 ms) keeps slots
 * reserved long enough for concurrent attackers to pile up against the
 * CAP while self-healing for legitimate 404s within a second.
 */
const ERROR_SLOT_HOLD_MS = parseInt(env.EXPORT_SSE_ERROR_HOLD_MS ?? '500', 10);

function releaseStreamDeferred(userId: string, controller: AbortController): void {
  setTimeout(() => releaseStream(userId, controller), ERROR_SLOT_HOLD_MS);
}

/**
 * SSE endpoint for export job progress.
 * GET /api/v1/export/progress?jobId=<jobId>
 *
 * Streams progress updates for async export jobs.
 * Reuses the same pattern as import progress (F02).
 */
export const GET: RequestHandler = async ({ request, url, locals, getClientAddress }) => {
  const auth = await resolveAuth({ request, url, locals, getClientAddress });
  if (!auth) return toErrorResponse('UNAUTHORIZED');
  if (!auth.userId) return toErrorResponse('FORBIDDEN');

  // H4: cap concurrent streams per user BEFORE any DB work.
  const abortSlot = registerStream(auth.userId);
  if (!abortSlot) return toErrorResponse('RATE_LIMITED', 'Too many concurrent progress streams');

  const userId = auth.userId;

  // Everything below must either reach the stream-start cleanup path
  // OR release the slot on throw.
  try {
    if (!locals.user) {
      releaseStreamDeferred(userId, abortSlot);
      throw error(401, 'Unauthorized');
    }
    const user = locals.user;

    const jobId = url.searchParams.get('jobId');
    if (!jobId) {
      releaseStreamDeferred(userId, abortSlot);
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
      releaseStreamDeferred(userId, abortSlot);
      throw error(404, 'Export job not found');
    }

    if (row.ownerId !== user.id) {
      releaseStreamDeferred(userId, abortSlot);
      throw error(403, 'Access denied');
    }

    const job = row;

    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        let released = false;
        let interval: ReturnType<typeof setInterval> | null = null;
        let idleTimer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (released) return;
          released = true;
          if (interval) clearInterval(interval);
          if (idleTimer) clearTimeout(idleTimer);
          releaseStream(userId, abortSlot);
          try {
            controller.close();
          } catch {
            // already closed
          }
        };

        const sendEvent = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(`event: ${event}\n`));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          } catch {
            // Controller closed between poll tick and enqueue.
          }
        };

        // Send current status immediately
        sendEvent('progress', {
          jobId,
          status: job.status,
          progress: job.progress,
          error: job.errorMessage,
        });

        // Poll for updates every second
        interval = setInterval(async () => {
          try {
            const updated = await db.query.importJobs.findFirst({
              where: eq(importJobs.id, jobId),
            });

            if (!updated) {
              sendEvent('error', { jobId, error: 'Job not found' });
              cleanup();
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
              cleanup();
            }
          } catch {
            sendEvent('error', { jobId, error: 'Polling failed' });
            cleanup();
          }
        }, 1000);

        // H4: server-side idle timeout — forces close even if client never aborts.
        idleTimer = setTimeout(() => {
          sendEvent('error', { jobId, error: 'Stream idle timeout' });
          cleanup();
        }, IDLE_TIMEOUT_MS);

        // Cleanup on client disconnect
        request.signal.addEventListener('abort', cleanup);
      },
      cancel() {
        // Runs when the consumer cancels the stream. Slot may already be
        // released via the close paths above; releaseStream is idempotent.
        releaseStream(userId, abortSlot);
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (err) {
    // Defense-in-depth: if anything above threw without releasing, defer
    // release so concurrent attack requests still see a held slot.
    releaseStreamDeferred(userId, abortSlot);
    throw err;
  }
};
