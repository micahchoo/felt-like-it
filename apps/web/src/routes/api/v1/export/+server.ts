import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { db } from '$lib/server/db/index.js';
import { importJobs, layers, maps } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { getExportData, toFeatureCollection } from '$lib/server/export/shared.js';
import { exportAsGeoPackage } from '$lib/server/export/geopackage.js';
import { exportAsShapefile } from '$lib/server/export/shapefile.js';
import { exportAsPdf } from '$lib/server/export/pdf.js';
import type { ExportFormat } from '$lib/stores/export-store.svelte.js';
import { resolveAuth, rateLimit } from '../middleware.js';
import { toErrorResponse } from '../errors.js';

interface ExportRequest {
  layerId?: string;
  layerIds?: string[];
  format: ExportFormat;
  includeAnnotations?: boolean;
  title?: string;
  screenshot?: string;
}

/**
 * Unified export endpoint with job tracking.
 * POST /api/v1/export
 *
 * Creates an export job and returns jobId for SSE progress tracking.
 * For immediate exports (single layer, no annotations), may return directly.
 */
export const POST: RequestHandler = async ({ request, url, locals, getClientAddress }) => {
  // H3: rate-limit BEFORE any work (JSON parse, ownership checks) so every
  // attempt increments the counter — matches the pattern in /api/v1/maps,
  // /api/v1/files, etc. resolveAuth yields the same userId hooks.server.ts
  // populates into locals.user; we keep the locals.user check as a
  // defense-in-depth fallback for cookie-session callers (embed flow).
  const auth = await resolveAuth({ request, url, locals, getClientAddress });
  if (!auth) return toErrorResponse('UNAUTHORIZED');

  const rateLimited = rateLimit(auth);
  if (rateLimited) return rateLimited;

  if (!locals.user) {
    throw error(401, 'Unauthorized');
  }
  const user = locals.user;

  let body: ExportRequest;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'Invalid JSON body');
  }

  const { layerId, layerIds, format, includeAnnotations, title, screenshot } = body;

  // Validate format
  const validFormats: ExportFormat[] = ['geojson', 'gpkg', 'shp', 'pdf'];
  if (!format || !validFormats.includes(format)) {
    throw error(400, `Invalid format. Supported: ${validFormats.join(', ')}`);
  }

  // Validate layer access
  const targetLayerIds = layerIds ?? (layerId ? [layerId] : []);
  if (targetLayerIds.length === 0) {
    throw error(400, 'No layers specified for export');
  }

  // Check ownership of all layers (joined query — no Drizzle relations declared)
  await Promise.all(
    targetLayerIds.map(async (id) => {
      const [row] = await db
        .select({ userId: maps.userId })
        .from(layers)
        .innerJoin(maps, eq(layers.mapId, maps.id))
        .where(eq(layers.id, id))
        .limit(1);
      if (!row || row.userId !== user.id) {
        throw error(403, `Access denied to layer ${id}`);
      }
    })
  );

  const firstLayerId = targetLayerIds[0];
  if (!firstLayerId) {
    throw error(400, 'No layers specified for export');
  }

  // For single-layer exports without annotations, use existing direct export
  if (targetLayerIds.length === 1 && !includeAnnotations) {
    // PDF is always async due to screenshot processing
    if (format !== 'pdf') {
      return await handleDirectExport(firstLayerId, format, user.id);
    }
  }

  // Create export job for async processing
  const jobId = randomUUID();
  const firstLayer = await db.query.layers.findFirst({
    where: eq(layers.id, firstLayerId),
  });
  if (!firstLayer) {
    throw error(404, 'Layer not found');
  }
  const mapId = firstLayer.mapId;

  await db.insert(importJobs).values({
    id: jobId,
    mapId,
    layerId: firstLayerId,
    status: 'pending',
    fileName: `export-${format}-${Date.now()}`,
    fileSize: 0,
    progress: 0,
  });

  // Start async processing (fire and forget)
  processExportJob(
    jobId,
    targetLayerIds,
    format,
    includeAnnotations,
    title,
    screenshot,
    user.id
  );

  // Return jobId for SSE progress tracking
  return new Response(JSON.stringify({ jobId, status: 'pending' }), {
    status: 202,
    headers: { 'Content-Type': 'application/json' },
  });
};

/**
 * Handle direct export for single-layer, non-PDF formats.
 */
async function handleDirectExport(
  layerId: string,
  format: ExportFormat,
  userId: string
): Promise<Response> {
  const data = await getExportData(layerId, userId);
  const basename = sanitizeFilename(data.layerName);

  switch (format) {
    case 'geojson': {
      const fc = toFeatureCollection(data);
      return new Response(JSON.stringify(fc, null, 2), {
        headers: {
          'Content-Type': 'application/geo+json',
          'Content-Disposition': `attachment; filename="${basename}.geojson"`,
        },
      });
    }

    case 'gpkg': {
      const buf = await exportAsGeoPackage(data);
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/geopackage+sqlite3',
          'Content-Disposition': `attachment; filename="${basename}.gpkg"`,
        },
      });
    }

    case 'shp': {
      const buf = await exportAsShapefile(data);
      return new Response(new Uint8Array(buf), {
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${basename}.shp.zip"`,
        },
      });
    }

    default:
      throw error(400, `Format ${format} requires async processing`);
  }
}

/**
 * Process export job asynchronously.
 * Updates job status/progress in database.
 */
async function processExportJob(
  jobId: string,
  layerIds: string[],
  format: ExportFormat,
  includeAnnotations: boolean | undefined,
  title: string | undefined,
  screenshot: string | undefined,
  userId: string
): Promise<void> {
  try {
    // Update to processing
    await db
      .update(importJobs)
      .set({ status: 'processing', progress: 10 })
      .where(eq(importJobs.id, jobId));

    // Process each layer
    const results: Array<{ layerName: string; data: Uint8Array | string; format: string }> = [];

    for (let i = 0; i < layerIds.length; i++) {
      const layerId = layerIds[i];
      if (!layerId) continue;
      const progress = 10 + Math.floor((i / layerIds.length) * 70);

      /* eslint-disable no-await-in-loop -- Sequential export preserves progress semantics; layers share job-row progress updates */
      await db.update(importJobs).set({ progress }).where(eq(importJobs.id, jobId));

      const data = await getExportData(layerId, userId);

      let result: Uint8Array | string;
      switch (format) {
        case 'geojson':
          result = JSON.stringify(toFeatureCollection(data), null, 2);
          break;
        case 'gpkg':
          result = await exportAsGeoPackage(data);
          break;
        case 'shp':
          result = await exportAsShapefile(data);
          break;
        case 'pdf': {
          const buf = await exportAsPdf({
            data,
            ...(title !== undefined ? { title } : {}),
            ...(screenshot !== undefined ? { screenshot } : {}),
          });
          result = new Uint8Array(buf);
          break;
        }
        default:
          throw new Error(`Unsupported format: ${format}`);
      }
      /* eslint-enable no-await-in-loop */

      results.push({ layerName: data.layerName, data: result, format });
    }

    // Handle annotations if requested
    if (includeAnnotations) {
      await db.update(importJobs).set({ progress: 90 }).where(eq(importJobs.id, jobId));

      // TODO: Fetch and include annotations
      // For now, just mark progress
    }

    // Mark complete
    await db
      .update(importJobs)
      .set({ status: 'done', progress: 100 })
      .where(eq(importJobs.id, jobId));
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Export failed';
    await db
      .update(importJobs)
      .set({ status: 'failed', errorMessage })
      .where(eq(importJobs.id, jobId));
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, '_');
}
