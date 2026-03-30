import { createReadStream } from 'fs';
import {
  detectCoordinateColumns,
  isValidLatitude,
  isValidLongitude,
} from '@felt-like-it/geo-engine';
import type { ParsedCsv, ParsedFeature } from './types.js';

/**
 * Parse a CSV file using papaparse streaming.
 * Returns headers and rows — coordinate detection and geocoding are
 * handled by the consumer (csvRowsToFeatures or application logic).
 */
export async function parseCSV(filePath: string): Promise<ParsedCsv> {
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
 * Convert parsed CSV rows to GeoJSON Point features using detected
 * lat/lng columns. Throws if no coordinate columns are found.
 *
 * NOTE: Geocoding (address→coordinates) stays in the consumer — it
 * needs API keys and progress callbacks that don't belong in a pure
 * parsing library.
 */
export function csvRowsToFeatures(
  headers: string[],
  rows: Record<string, string>[]
): ParsedFeature[] {
  const coordCols = detectCoordinateColumns(headers);

  if (!coordCols) {
    throw new Error(
      'Could not detect latitude/longitude columns. ' +
        'Expected column names like "lat"/"lng", "latitude"/"longitude", etc.'
    );
  }

  const { latCol, lngCol } = coordCols;
  const features: ParsedFeature[] = [];

  for (const row of rows) {
    const lat = parseFloat(row[latCol] ?? '');
    const lng = parseFloat(row[lngCol] ?? '');
    if (!isValidLatitude(lat) || !isValidLongitude(lng)) continue;

    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key !== latCol && key !== lngCol) properties[key] = value;
    }

    features.push({
      geometry: {
        type: 'Point' as const,
        coordinates: [lng, lat] as [number, number],
      },
      properties,
    });
  }

  if (features.length === 0) {
    throw new Error(
      `No valid coordinate rows found. Tried lat column: "${latCol}", lng column: "${lngCol}"`
    );
  }

  return features;
}
