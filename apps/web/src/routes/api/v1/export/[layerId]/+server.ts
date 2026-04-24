import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getExportData, toFeatureCollection } from '$lib/server/export/shared.js';
import { exportAsGeoPackage } from '$lib/server/export/geopackage.js';
import { exportAsShapefile } from '$lib/server/export/shapefile.js';
import { exportAsPdf } from '$lib/server/export/pdf.js';

// H7: cap PDF export inputs. screenshot is a data URL (~base64) — 2 MB cap
// keeps render work bounded; title drives filename/metadata so 500 chars is ample.
const ExportPdfSchema = z
  .object({
    screenshot: z.string().max(2_000_000).optional(),
    title: z.string().max(500).optional(),
  })
  .strict();

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

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    error(400, 'Invalid JSON body');
  }

  const parsed = ExportPdfSchema.safeParse(raw);
  if (!parsed.success) {
    error(422, parsed.error.issues[0]?.message ?? 'Invalid export payload');
  }
  const body = parsed.data;

  const data = await getExportData(params.layerId, locals.user.id);

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
