/**
 * Shapefile export — generates a .zip containing .shp/.dbf/.shx/.prj
 * using @mapbox/shp-write.
 *
 * Shapefile limitations:
 *  - Single geometry type per file (Point, Polygon, or Polyline)
 *  - DBF field names max 10 characters
 *  - DBF string values max 254 characters
 */

import { zip } from '@mapbox/shp-write';
import { error } from '@sveltejs/kit';
import type { ExportData } from './shared.js';
import { toFeatureCollection } from './shared.js';

/**
 * Truncate property keys to 10 chars and string values to 254 chars (DBF limits).
 */
function truncateProperties(
  fc: GeoJSON.FeatureCollection
): GeoJSON.FeatureCollection {
  return {
    ...fc,
    features: fc.features.map((f) => {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(f.properties ?? {})) {
        const key = k.slice(0, 10);
        props[key] = typeof v === 'string' ? v.slice(0, 254) : v;
      }
      return { ...f, properties: props };
    }),
  };
}

export async function exportAsShapefile(data: ExportData): Promise<Buffer> {
  if (data.layerType === 'mixed') {
    error(400, 'Shapefile export requires a single geometry type (point, line, or polygon). This layer has mixed geometry types.');
  }

  const fc = toFeatureCollection(data);
  const truncated = truncateProperties(fc);

  const result = await zip<'nodebuffer'>(truncated, {
    outputType: 'nodebuffer',
    compression: 'DEFLATE',
  });

  return Buffer.from(result);
}
