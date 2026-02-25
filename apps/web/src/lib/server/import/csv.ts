import { createReadStream } from 'fs';
import {
  detectCoordinateColumns,
  detectAddressColumn,
  isValidLatitude,
  isValidLongitude,
  geocodeBatch,
  type GeocodingOptions,
} from '@felt-like-it/geo-engine';
import type { Geometry } from '@felt-like-it/shared-types';
import { db, importJobs } from '../db/index.js';
import { eq } from 'drizzle-orm';
import { createLayerAndInsertFeatures } from './shared.js';
import type { ImportResult } from './shared.js';

/**
 * Parse a CSV file and return rows.
 * Uses streaming via papaparse for large files.
 */
async function parseCSV(filePath: string): Promise<{ headers: string[]; rows: Record<string, string>[] }> {
  const { default: Papa } = await import('papaparse');

  return new Promise((resolve, reject) => {
    const rows: Record<string, string>[] = [];
    let headers: string[] = [];

    Papa.parse(createReadStream(filePath), {
      header: true,
      skipEmptyLines: true,
      step: (result) => {
        if (headers.length === 0 && result.meta.fields) {
          headers = result.meta.fields;
        }
        rows.push(result.data as Record<string, string>);
      },
      complete: () => resolve({ headers, rows }),
      error: (err: Error) => reject(err),
    });
  });
}

/**
 * Import a CSV file with lat/lng columns into a new point layer.
 */
export async function importCSV(
  filePath: string,
  mapId: string,
  layerName: string,
  jobId: string
): Promise<ImportResult> {
  const { headers, rows } = await parseCSV(filePath);

  if (rows.length === 0) {
    throw new Error('CSV file is empty');
  }

  type Feature = { geometry: Geometry; properties: Record<string, unknown> };
  let validFeatures: Feature[];

  // ── Path A: explicit lat/lng columns ──────────────────────────────────────
  const coordCols = detectCoordinateColumns(headers);

  if (coordCols) {
    const { latCol, lngCol } = coordCols;
    const acc: Feature[] = [];

    for (const row of rows) {
      const lat = parseFloat(row[latCol] ?? '');
      const lng = parseFloat(row[lngCol] ?? '');
      if (!isValidLatitude(lat) || !isValidLongitude(lng)) continue;

      const properties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        if (key !== latCol && key !== lngCol) properties[key] = value;
      }
      acc.push({ geometry: { type: 'Point' as const, coordinates: [lng, lat] as [number, number] }, properties });
    }

    if (acc.length === 0) {
      throw new Error(
        `No valid coordinate rows found. Tried lat column: "${latCol}", lng column: "${lngCol}"`
      );
    }
    validFeatures = acc;

  // ── Path B: address column -> Nominatim geocoding ──────────────────────────
  } else {
    const addrCol = detectAddressColumn(headers);

    if (!addrCol) {
      throw new Error(
        'Could not detect latitude/longitude columns, and no address column was found. ' +
        'Add lat/lng columns, or name an address column "address", "location", or similar.'
      );
    }

    // Pair each row with its address; skip blank addresses early
    const indexed = rows
      .map((row, i) => ({ row, i, address: (row[addrCol] ?? '').trim() }))
      .filter(({ address }) => address.length > 0);

    if (indexed.length === 0) {
      throw new Error(`Address column "${addrCol}" is empty in all rows`);
    }

    const geocodingOptions: GeocodingOptions = {
      nominatimUrl: process.env['NOMINATIM_URL'] ?? undefined,
      userAgent: process.env['GEOCODING_USER_AGENT'] ?? 'felt-like-it/1.0',
      rateDelayMs: 1_100,
    };

    const geocodeResults = await geocodeBatch(
      indexed.map(({ address }) => address),
      async (completed, total) => {
        const progress = Math.round(10 + (completed / total) * 80);
        await db.update(importJobs).set({ progress }).where(eq(importJobs.id, jobId));
      },
      geocodingOptions
    );

    const acc: Feature[] = [];
    for (let i = 0; i < indexed.length; i++) {
      const point = geocodeResults[i];
      if (!point) continue; // Geocoding failed for this address — skip row
      const { row } = indexed[i] as { row: Record<string, string>; i: number; address: string };
      const properties: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        properties[key] = value; // keep address column in properties
      }
      acc.push({ geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] as [number, number] }, properties });
    }

    if (acc.length === 0) {
      throw new Error(
        `Geocoding failed for all ${indexed.length} rows. ` +
        'Check address values or NOMINATIM_URL configuration.'
      );
    }
    validFeatures = acc;
  }

  return createLayerAndInsertFeatures({
    mapId,
    jobId,
    layerName,
    features: validFeatures,
    layerTypeOverride: 'point',
  });
}
