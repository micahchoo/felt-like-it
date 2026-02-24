import { error } from '@sveltejs/kit';
import { eq, and } from 'drizzle-orm';
import { db, layers, maps, mapCollaborators } from '../db/index.js';
import { getLayerFeatures, type GeoJSONFeatureRow } from '../geo/queries.js';

export interface ExportData {
  layerId: string;
  layerName: string;
  layerType: string;
  features: GeoJSONFeatureRow[];
}

/**
 * Fetch export data for a layer with viewer+ access check.
 * Uses SvelteKit error() (not TRPCError) since export routes are plain endpoints.
 */
export async function getExportData(layerId: string, userId: string): Promise<ExportData> {
  const [layer] = await db
    .select({ id: layers.id, mapId: layers.mapId, name: layers.name, type: layers.type })
    .from(layers)
    .where(eq(layers.id, layerId));

  if (!layer) error(404, 'Layer not found');

  // Owner fast-path
  const [map] = await db
    .select({ userId: maps.userId })
    .from(maps)
    .where(eq(maps.id, layer.mapId));

  if (!map) error(404, 'Layer not found');

  if (map.userId !== userId) {
    // Collaborator path
    const [collab] = await db
      .select({ role: mapCollaborators.role })
      .from(mapCollaborators)
      .where(and(eq(mapCollaborators.mapId, layer.mapId), eq(mapCollaborators.userId, userId)));

    if (!collab) error(404, 'Layer not found');
    // Any collaborator role (viewer+) can export
  }

  const features = await getLayerFeatures(layerId);

  return {
    layerId: layer.id,
    layerName: layer.name,
    layerType: layer.type,
    features,
  };
}

/**
 * Build a GeoJSON FeatureCollection from export data.
 */
export function toFeatureCollection(data: ExportData): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: data.features.map((row) => ({
      type: 'Feature' as const,
      id: row.id,
      geometry: row.geometry as GeoJSON.Geometry,
      properties: row.properties,
    })),
  };
}
