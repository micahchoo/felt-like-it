import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { annotationService } from '$lib/server/annotations/service.js';
import { annotationsToFeatureCollection } from '$lib/server/export/annotations.js';

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, '_');
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
  if (!locals.user) error(401, 'Unauthorized');

  const { mapId } = params;

  // annotationService.list checks viewer access internally
  const { items } = await annotationService.list({
    userId: locals.user.id,
    mapId,
  });

  const fc = annotationsToFeatureCollection(items);
  const basename = sanitizeFilename(`annotations-${mapId.slice(0, 8)}`);

  return new Response(JSON.stringify(fc, null, 2), {
    headers: {
      'Content-Type': 'application/geo+json',
      'Content-Disposition': `attachment; filename="${basename}.geojson"`,
    },
  });
};
