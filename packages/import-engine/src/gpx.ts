import { readFile } from 'fs/promises';
import { XMLParser } from 'fast-xml-parser';
import type { ParsedFeature } from './types.js';

/** Ensure a value is an array (XML parsers may return a single object or an array). */
function ensureArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** Extract a coordinate pair from a GPX element with @_lat and @_lon attributes. */
function extractPoint(
  el: Record<string, unknown>
): [number, number] | [number, number, number] | null {
  const lat = Number(el['@_lat']);
  const lon = Number(el['@_lon']);
  if (isNaN(lat) || isNaN(lon)) return null;

  const ele = el['ele'];
  if (typeof ele === 'number' || typeof ele === 'string') {
    const elevation = Number(ele);
    if (!isNaN(elevation)) return [lon, lat, elevation];
  }

  return [lon, lat];
}

/** Extract properties from a GPX element (name, desc, cmt, time, etc.). */
function extractProperties(
  el: Record<string, unknown>
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const propKeys = ['name', 'desc', 'cmt', 'time', 'type', 'sym', 'src'];

  for (const key of propKeys) {
    const val = el[key];
    if (val !== undefined && val !== null) {
      props[key] = typeof val === 'object' ? String(val) : val;
    }
  }

  return props;
}

/**
 * Parse a GPX file into normalized GeoJSON features.
 * Uses fast-xml-parser to parse XML and extracts:
 * - Waypoints (wpt) as Point geometries
 * - Tracks (trk/trkseg/trkpt) as LineString geometries
 * - Routes (rte/rtept) as LineString geometries
 */
export async function parseGPX(filePath: string): Promise<ParsedFeature[]> {
  const raw = await readFile(filePath, 'utf-8');

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    isArray: (tagName) =>
      ['wpt', 'trk', 'trkseg', 'trkpt', 'rte', 'rtept'].includes(tagName),
  });

  const parsed = parser.parse(raw) as Record<string, unknown>;
  const gpx = parsed['gpx'] as Record<string, unknown> | undefined;

  if (!gpx) {
    throw new Error('Invalid GPX: missing <gpx> root element');
  }

  const features: ParsedFeature[] = [];

  // ── Waypoints → Points ────────────────────────────────────────────────────
  const waypoints = ensureArray(
    gpx['wpt'] as Record<string, unknown>[] | Record<string, unknown> | undefined
  );
  for (const wpt of waypoints) {
    const coord = extractPoint(wpt);
    if (!coord) continue;

    features.push({
      geometry: { type: 'Point', coordinates: coord },
      properties: extractProperties(wpt),
    });
  }

  // ── Tracks → LineStrings ──────────────────────────────────────────────────
  const tracks = ensureArray(
    gpx['trk'] as Record<string, unknown>[] | Record<string, unknown> | undefined
  );
  for (const trk of tracks) {
    const segments = ensureArray(
      trk['trkseg'] as
        | Record<string, unknown>[]
        | Record<string, unknown>
        | undefined
    );

    for (const seg of segments) {
      const trackpoints = ensureArray(
        seg['trkpt'] as
          | Record<string, unknown>[]
          | Record<string, unknown>
          | undefined
      );

      const coords: Array<[number, number] | [number, number, number]> = [];
      for (const trkpt of trackpoints) {
        const coord = extractPoint(trkpt);
        if (coord) coords.push(coord);
      }

      if (coords.length >= 2) {
        features.push({
          geometry: { type: 'LineString', coordinates: coords },
          properties: extractProperties(trk),
        });
      }
    }
  }

  // ── Routes → LineStrings ──────────────────────────────────────────────────
  const routes = ensureArray(
    gpx['rte'] as Record<string, unknown>[] | Record<string, unknown> | undefined
  );
  for (const rte of routes) {
    const routepoints = ensureArray(
      rte['rtept'] as
        | Record<string, unknown>[]
        | Record<string, unknown>
        | undefined
    );

    const coords: Array<[number, number] | [number, number, number]> = [];
    for (const rtept of routepoints) {
      const coord = extractPoint(rtept);
      if (coord) coords.push(coord);
    }

    if (coords.length >= 2) {
      features.push({
        geometry: { type: 'LineString', coordinates: coords },
        properties: extractProperties(rte),
      });
    }
  }

  return features;
}
