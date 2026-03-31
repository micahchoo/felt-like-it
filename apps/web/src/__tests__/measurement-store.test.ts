import { describe, it, expect } from 'vitest';
import { MeasurementStore } from '$lib/stores/measurement-store.svelte.js';

describe('MeasurementStore', () => {
  it('starts with no active measurement and no result', () => {
    const store = new MeasurementStore();
    expect(store.active).toBe(false);
    expect(store.currentResult).toBe(null);
  });

  it('toggles active state', () => {
    const store = new MeasurementStore();
    store.toggle();
    expect(store.active).toBe(true);
    store.toggle();
    expect(store.active).toBe(false);
  });

  it('stores measurement result when set', () => {
    const store = new MeasurementStore();
    const result = {
      type: 'distance' as const,
      value: 1500,
      vertexCount: 3,
      distanceKm: 1.5,
      geometry: {
        type: 'LineString' as const,
        coordinates: [
          [0, 0],
          [1, 1],
          [2, 0],
        ] as [number, number][],
      },
    };
    store.setResult(result);
    expect(store.currentResult).toStrictEqual(result);
  });

  it('clears current result', () => {
    const store = new MeasurementStore();
    store.setResult({
      type: 'distance',
      value: 100,
      vertexCount: 2,
      distanceKm: 0.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    });
    store.clear();
    expect(store.currentResult).toBe(null);
  });

  it('produces SaveAsAnnotationPayload for distance', () => {
    const store = new MeasurementStore();
    store.setResult({
      type: 'distance',
      value: 1500,
      vertexCount: 3,
      distanceKm: 1.5,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
          [2, 0],
        ],
      },
    });
    const payload = store.saveAsAnnotation();
    expect(payload.title).toBe('Distance: 1.50 km');
    expect(payload.content.toLowerCase()).toContain('measurement');
    expect(payload.geometry.type).toBe('LineString');
    expect(payload.geometry.coordinates).toHaveLength(3);
  });

  it('produces SaveAsAnnotationPayload for area', () => {
    const store = new MeasurementStore();
    store.setResult({
      type: 'area',
      value: 5000000,
      vertexCount: 4,
      areaKm2: 5.0,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    });
    const payload = store.saveAsAnnotation();
    expect(payload.title).toBe('Area: 5.00 km²');
    expect(payload.content.toLowerCase()).toContain('measurement');
    expect(payload.geometry.type).toBe('Polygon');
  });

  it('returns null from saveAsAnnotation when no result', () => {
    const store = new MeasurementStore();
    expect(store.saveAsAnnotation()).toBe(null);
  });

  it('clears result after saveAsAnnotation', () => {
    const store = new MeasurementStore();
    store.setResult({
      type: 'distance',
      value: 100,
      vertexCount: 2,
      distanceKm: 0.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    });
    store.saveAsAnnotation();
    expect(store.currentResult).toBe(null);
  });

  it('tracks history of measurements', () => {
    const store = new MeasurementStore();
    store.setResult({
      type: 'distance',
      value: 100,
      vertexCount: 2,
      distanceKm: 0.1,
      geometry: {
        type: 'LineString',
        coordinates: [
          [0, 0],
          [1, 1],
        ],
      },
    });
    store.setResult({
      type: 'area',
      value: 200,
      vertexCount: 4,
      areaKm2: 0.2,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 1],
            [0, 0],
          ],
        ],
      },
    });
    expect(store.history).toHaveLength(2);
    expect(store.history[0].type).toBe('distance');
    expect(store.history[1].type).toBe('area');
  });
});
