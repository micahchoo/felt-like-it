import { readFile } from 'fs/promises';
import { XMLParser } from 'fast-xml-parser';
import type { Geometry } from '@felt-like-it/shared-types';
import type { ParsedFeature } from './types.js';

/**
 * Parse KML coordinate string into an array of [lng, lat] or [lng, lat, alt] tuples.
 * KML format: "lng,lat,alt lng,lat,alt" (space-separated, comma within each tuple).
 */
function parseKmlCoordinates(
  coordStr: string
): Array<[number, number] | [number, number, number]> {
  const tuples = coordStr
    .trim()
    .split(/\s+/)
    .filter((s) => s.length > 0);

  const coords: Array<[number, number] | [number, number, number]> = [];

  for (const tuple of tuples) {
    const parts = tuple.split(',').map(Number);
    const lng = parts[0];
    const lat = parts[1];
    const alt = parts[2];

    if (lng === undefined || lat === undefined || isNaN(lng) || isNaN(lat)) {
      continue;
    }

    if (alt !== undefined && !isNaN(alt)) {
      coords.push([lng, lat, alt]);
    } else {
      coords.push([lng, lat]);
    }
  }

  return coords;
}

/** Ensure a value is an array (XML parsers may return a single object or an array). */
function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Extract geometry from a KML Placemark element. Returns null if no supported geometry. */
function extractPlacemarkGeometry(
  placemark: Record<string, unknown>
): Geometry | null {
  // Point
  const point = placemark['Point'] as
    | { coordinates?: string }
    | undefined;
  if (point?.coordinates) {
    const coords = parseKmlCoordinates(point.coordinates);
    if (coords.length > 0 && coords[0]) {
      return { type: 'Point', coordinates: coords[0] };
    }
  }

  // LineString
  const lineString = placemark['LineString'] as
    | { coordinates?: string }
    | undefined;
  if (lineString?.coordinates) {
    const coords = parseKmlCoordinates(lineString.coordinates);
    if (coords.length >= 2) {
      return {
        type: 'LineString',
        coordinates: coords,
      };
    }
  }

  // Polygon
  const polygon = placemark['Polygon'] as
    | {
        outerBoundaryIs?: {
          LinearRing?: { coordinates?: string };
        };
        innerBoundaryIs?:
          | { LinearRing?: { coordinates?: string } }
          | Array<{ LinearRing?: { coordinates?: string } }>;
      }
    | undefined;
  if (polygon?.outerBoundaryIs?.LinearRing?.coordinates) {
    const outerCoords = parseKmlCoordinates(
      polygon.outerBoundaryIs.LinearRing.coordinates
    );
    if (outerCoords.length >= 4) {
      const rings: Array<Array<[number, number] | [number, number, number]>> =
        [outerCoords];

      // Inner boundaries (holes)
      const innerBoundaries = ensureArray(polygon.innerBoundaryIs);
      for (const inner of innerBoundaries) {
        if (inner?.LinearRing?.coordinates) {
          const innerCoords = parseKmlCoordinates(
            inner.LinearRing.coordinates
          );
          if (innerCoords.length >= 4) {
            rings.push(innerCoords);
          }
        }
      }

      return { type: 'Polygon', coordinates: rings };
    }
  }

  // MultiGeometry — recurse and collect
  const multiGeometry = placemark['MultiGeometry'] as
    | Record<string, unknown>
    | undefined;
  if (multiGeometry) {
    const geom = extractPlacemarkGeometry(multiGeometry);
    if (geom) return geom;
  }

  return null;
}

/** Extract properties from a KML Placemark element. */
function extractPlacemarkProperties(
  placemark: Record<string, unknown>
): Record<string, unknown> {
  const props: Record<string, unknown> = {};

  if (typeof placemark['name'] === 'string') {
    props['name'] = placemark['name'];
  }
  if (typeof placemark['description'] === 'string') {
    props['description'] = placemark['description'];
  }

  // ExtendedData/Data elements
  const extendedData = placemark['ExtendedData'] as
    | { Data?: Array<{ '@_name'?: string; value?: string }> | { '@_name'?: string; value?: string } }
    | undefined;
  if (extendedData?.Data) {
    const dataItems = ensureArray(extendedData.Data);
    for (const item of dataItems) {
      if (item['@_name'] && item.value !== undefined) {
        props[item['@_name']] = item.value;
      }
    }
  }

  return props;
}

/**
 * Recursively collect Placemarks from a KML document structure.
 * Handles nested Folder and Document elements.
 */
function collectPlacemarks(
  node: Record<string, unknown>
): Array<Record<string, unknown>> {
  const placemarks: Array<Record<string, unknown>> = [];

  // Direct Placemarks
  const directPlacemarks = ensureArray(
    node['Placemark'] as Record<string, unknown> | Record<string, unknown>[] | undefined
  );
  placemarks.push(...directPlacemarks);

  // Nested Folders
  const folders = ensureArray(
    node['Folder'] as Record<string, unknown> | Record<string, unknown>[] | undefined
  );
  for (const folder of folders) {
    placemarks.push(...collectPlacemarks(folder));
  }

  // Nested Documents
  const documents = ensureArray(
    node['Document'] as Record<string, unknown> | Record<string, unknown>[] | undefined
  );
  for (const doc of documents) {
    placemarks.push(...collectPlacemarks(doc));
  }

  return placemarks;
}

/**
 * Parse a KML file into normalized GeoJSON features.
 * Uses fast-xml-parser to parse XML and extracts Placemarks with
 * Point, LineString, and Polygon geometries.
 */
export async function parseKML(filePath: string): Promise<ParsedFeature[]> {
  const raw = await readFile(filePath, 'utf-8');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (tagName) =>
      ['Placemark', 'Folder', 'Document', 'Data', 'innerBoundaryIs'].includes(
        tagName
      ),
  });

  const parsed = parser.parse(raw) as Record<string, unknown>;
  const kml = parsed['kml'] as Record<string, unknown> | undefined;

  if (!kml) {
    throw new Error('Invalid KML: missing <kml> root element');
  }

  const placemarks = collectPlacemarks(kml);
  const features: ParsedFeature[] = [];

  for (const placemark of placemarks) {
    const geometry = extractPlacemarkGeometry(placemark);
    if (!geometry) continue;

    const properties = extractPlacemarkProperties(placemark);
    features.push({ geometry, properties });
  }

  return features;
}
