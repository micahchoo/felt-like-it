import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { exportLayerAsGeoJSON } from '$lib/server/export/geojson.js';
import { db, layers } from '$lib/server/db/index.js';
import { eq } from 'drizzle-orm';

export const GET: RequestHandler = async ({ params, locals }) => {
  if (!locals.user) {
    error(401, 'Unauthorized');
  }

  try {
    const geojson = await exportLayerAsGeoJSON({
      layerId: params.layerId,
      userId: locals.user.id,
    });

    // Determine filename from layer name
    const [layer] = await db
      .select({ name: layers.name })
      .from(layers)
      .where(eq(layers.id, params.layerId));

    const filename = `${(layer?.name ?? 'layer').replace(/[^a-z0-9_-]/gi, '_')}.geojson`;

    return new Response(geojson, {
      headers: {
        'Content-Type': 'application/geo+json',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Export failed';
    if (message === 'Layer not found') error(404, message);
    if (message === 'Access denied') error(403, message);
    error(500, message);
  }
};
