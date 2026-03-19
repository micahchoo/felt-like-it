/**
 * annotation-geo.svelte.ts
 *
 * Pure derivation functions that transform AnnotationObject[] into GeoJSON
 * FeatureCollections for MapCanvas rendering.
 *
 * Extracted from MapEditor.svelte to allow unit testing and reuse.
 */

import type { AnnotationObject } from '@felt-like-it/shared-types';

// Re-export the canonical row type under the local alias used throughout this file.
export type AnnotationRow = AnnotationObject;

// ─── Return types ─────────────────────────────────────────────────────────────

export type AnnotationPinCollection = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: {
      authorName: string;
      createdAt: string;
      contentJson: string;
      anchorType: string;
    };
  }[];
};

export type AnnotationRegionCollection = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    id: string;
    geometry: { type: 'Polygon'; coordinates: number[][][] };
    properties: {
      authorName: string;
      createdAt: string;
      contentJson: string;
      anchorType: string;
    };
  }[];
};

export type MeasurementFeatureCollection = {
  type: 'FeatureCollection';
  features: {
    type: 'Feature';
    geometry: unknown;
    properties: Record<string, unknown>;
  }[];
};

// ─── Pure derivation functions (testable without Svelte) ─────────────────────

export function deriveAnnotationPins(rows: AnnotationRow[]): AnnotationPinCollection {
  return {
    type: 'FeatureCollection',
    features: rows
      .filter((a) => a.anchor.type === 'point' && !('parentId' in a && a.parentId))
      .map((a) => ({
        type: 'Feature' as const,
        id: a.id,
        geometry:
          a.anchor.type === 'point'
            ? { type: 'Point' as const, coordinates: a.anchor.geometry.coordinates.slice(0, 2) as [number, number] }
            : { type: 'Point' as const, coordinates: [0, 0] as [number, number] },
        properties: {
          authorName: a.authorName,
          createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
          contentJson: JSON.stringify(a.content),
          anchorType: a.anchor.type,
        },
      })),
  };
}

export function deriveAnnotationRegions(rows: AnnotationRow[]): AnnotationRegionCollection {
  return {
    type: 'FeatureCollection',
    features: rows
      .filter((a) => a.anchor.type === 'region' && !('parentId' in a && a.parentId))
      .map((a) => ({
        type: 'Feature' as const,
        id: a.id,
        geometry:
          a.anchor.type === 'region'
            ? a.anchor.geometry
            : { type: 'Polygon' as const, coordinates: [] },
        properties: {
          authorName: a.authorName,
          createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
          contentJson: JSON.stringify(a.content),
          anchorType: a.anchor.type,
        },
      })),
  };
}

export function deriveAnnotatedFeaturesIndex(rows: AnnotationRow[]): Map<string, { layerId: string; count: number }> {
  const featureAnchored = rows.filter(
    (a: { anchor: { type: string } }) => a.anchor.type === 'feature'
  );
  const featureMap = new Map<string, { layerId: string; count: number }>();
  for (const ann of featureAnchored) {
    const anchor = ann.anchor as { type: 'feature'; featureId: string; layerId: string };
    const key = anchor.featureId;
    const existing = featureMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      featureMap.set(key, { layerId: anchor.layerId, count: 1 });
    }
  }
  return featureMap;
}

export function deriveMeasurementData(rows: AnnotationRow[]): MeasurementFeatureCollection {
  const measurementAnchored = rows.filter(
    (a: { anchor: { type: string } }) => a.anchor.type === 'measurement'
  );
  const measurementFeatures = measurementAnchored.map((ann) => {
    const anchor = ann.anchor as { type: 'measurement'; geometry: { type: string; coordinates: unknown } };
    const body = ann.content.kind === 'single' ? ann.content.body : null;
    const label = body?.type === 'measurement' ? (body as { displayValue: string }).displayValue : '';
    return {
      type: 'Feature' as const,
      geometry: anchor.geometry,
      properties: { id: ann.id, label, annotationId: ann.id },
    };
  });
  return { type: 'FeatureCollection' as const, features: measurementFeatures };
}

// ─── Reactive factory for component use ──────────────────────────────────────

export function createAnnotationGeoStore(getRows: () => AnnotationRow[]) {
  const rows = $derived(getRows());
  return {
    get pins() { return deriveAnnotationPins(rows); },
    get regions() { return deriveAnnotationRegions(rows); },
    get index() { return deriveAnnotatedFeaturesIndex(rows); },
    get measurements() { return deriveMeasurementData(rows); },
  };
}
