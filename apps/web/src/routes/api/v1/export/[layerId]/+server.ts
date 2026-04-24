import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getExportData, toFeatureCollection } from '$lib/server/export/shared.js';
import { exportAsGeoPackage } from '$lib/server/export/geopackage.js';
import { exportAsShapefile } from '$lib/server/export/shapefile.js';
import { exportAsPdf } from '$lib/server/export/pdf.js';

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-z0-9_-]/gi, '_');
}

export const GET: RequestHandler = async ({ params, locals, url }) => {
  if (!locals.user) error(401, 'Unauthorized');

  const format = url.searchParams.get('format') ?? 'geojson';
  const data = await getExportData(params.layerId, locals.user.id);
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
      error(400, `Unsupported format: ${format}. Supported: geojson, gpkg, shp`);
  }
};

export const POST: RequestHandler = async ({ params, locals, request }) => {
  if (!locals.user) error(401, 'Unauthorized');

  const data = await getExportData(params.layerId, locals.user.id);

  let body: { screenshot?: string; title?: string };
  try {
    body = await request.json() as { screenshot?: string; title?: string };
  } catch {
    error(400, 'Invalid JSON body');
  }

  const buf = await exportAsPdf({
    data,
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.screenshot !== undefined ? { screenshot: body.screenshot } : {}),
  });

  const basename = sanitizeFilename(data.layerName);

  return new Response(new Uint8Array(buf), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${basename}.pdf"`,
    },
  });
};
