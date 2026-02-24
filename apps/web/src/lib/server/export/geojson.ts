import { db, layers, maps } from '../db/index.js';
import { getLayerFeatures } from '../geo/queries.js';
import { eq, and } from 'drizzle-orm';

export interface ExportOptions {
  layerId: string;
  userId: string;
}

/**
 * Export a layer as a GeoJSON FeatureCollection string.
 * Verifies the user owns the map this layer belongs to.
 */
export async function exportLayerAsGeoJSON(options: ExportOptions): Promise<string> {
  const { layerId, userId } = options;

  const [layer] = await db
    .select({ id: layers.id, mapId: layers.mapId, name: layers.name })
    .from(layers)
    .where(eq(layers.id, layerId));

  if (!layer) {
    throw new Error('Layer not found');
  }

  const [map] = await db
    .select()
    .from(maps)
    .where(and(eq(maps.id, layer.mapId), eq(maps.userId, userId)));

  if (!map) {
    throw new Error('Access denied');
  }

  const rows = await getLayerFeatures(layerId);

  const featureCollection = {
    type: 'FeatureCollection',
    features: rows.map((row) => ({
      type: 'Feature',
      id: row.id,
      geometry: row.geometry,
      properties: row.properties,
    })),
  };

  return JSON.stringify(featureCollection, null, 2);
}
