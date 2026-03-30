import { validateGeoJSON } from '@felt-like-it/geo-engine';
import type { Geometry } from '@felt-like-it/shared-types';
import { readFile } from 'fs/promises';
import type { ParsedFeature } from './types.js';

/** Narrow parsed JSON to a GeoJSON Feature with geometry and optional properties. */
function isGeoJSONFeature(
  data: unknown
): data is {
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown> | null;
} {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>)['type'] === 'Feature' &&
    typeof (data as Record<string, unknown>)['geometry'] === 'object'
  );
}

/** Narrow parsed JSON to a bare GeoJSON geometry (has type + coordinates). */
function isGeoJSONGeometry(
  data: unknown
): data is { type: string; coordinates: unknown } {
  return (
    typeof data === 'object' &&
    data !== null &&
    'type' in data &&
    'coordinates' in data
  );
}

/**
 * Parse a GeoJSON file into normalized features.
 * Handles FeatureCollection, single Feature, and bare Geometry inputs.
 * Filters out features with null/undefined geometry.
 */
export async function parseGeoJSON(filePath: string): Promise<ParsedFeature[]> {
  const raw = await readFile(filePath, 'utf-8');
  let geojson: unknown;

  try {
    geojson = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON in file');
  }

  const validation = validateGeoJSON(geojson);
  if (!validation.valid) {
    throw new Error(`Invalid GeoJSON: ${validation.errors.slice(0, 3).join(', ')}`);
  }

  const data = geojson as {
    type: string;
    features?: Array<{
      geometry: { type: string; coordinates: unknown } | null;
      properties: Record<string, unknown> | null;
    }>;
  };

  let featureList: ParsedFeature[];

  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    featureList = data.features
      .filter((f) => f.geometry !== null && f.geometry !== undefined)
      .map((f) => ({
        geometry: f.geometry as Geometry,
        properties: f.properties ?? {},
      }));
  } else if (isGeoJSONFeature(geojson)) {
    featureList = [
      {
        geometry: geojson.geometry as Geometry,
        properties: geojson.properties ?? {},
      },
    ];
  } else if (isGeoJSONGeometry(geojson)) {
    featureList = [{ geometry: geojson as Geometry, properties: {} }];
  } else {
    throw new Error('Unrecognized GeoJSON structure');
  }

  if (featureList.length === 0) {
    throw new Error('GeoJSON contains no features');
  }

  return featureList;
}
