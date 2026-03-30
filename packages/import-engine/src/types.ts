import type { Geometry } from '@felt-like-it/shared-types';

/** Standard parsed feature — GeoJSON geometry + properties. */
export interface ParsedFeature {
  geometry: Geometry;
  properties: Record<string, unknown>;
}

/**
 * GeoPackage parsed feature — WKB binary + SRID.
 * Both web and worker pass WKB directly to PostGIS via ST_GeomFromWKB.
 */
export interface ParsedWkbFeature {
  wkbHex: string;
  srid: number;
  properties: Record<string, unknown>;
}

/** Parsed CSV with headers preserved for coordinate detection. */
export interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}
