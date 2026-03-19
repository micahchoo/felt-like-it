import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { filterStore, loadFilters, saveFilters } from '../lib/stores/filters.svelte.js';
import type { GeoJSONFeature } from '@felt-like-it/shared-types';

// geo-engine module is ESM — mock it so fslFiltersToMapLibre returns a simple
// MapLibre expression without needing the full module tree.
vi.mock('@felt-like-it/geo-engine', () => ({
  fslFiltersToMapLibre: (filters: unknown[][]) => {
    if (!filters || filters.length === 0) return null;
    if (filters.length === 1) {
      const [field, _op, value] = filters[0] as [string, string, string];
      return ['==', ['get', field], value] as unknown[];
    }
    return ['all', ...filters.map(([f, , v]) => ['==', ['get', f], v])] as unknown[];
  },
}));

import { vi } from 'vitest';

const LAYER_A = 'aaaa-aaaa';
const LAYER_B = 'bbbb-bbbb';

function makeFeature(id: string, props: Record<string, unknown>): GeoJSONFeature {
  return {
    id,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: props,
  } as GeoJSONFeature;
}

describe('filterStore — basic CRUD', () => {
  beforeEach(() => {
    filterStore.clear(LAYER_A);
    filterStore.clear(LAYER_B);
  });

  it('starts empty', () => {
    expect(filterStore.get(LAYER_A)).toEqual([]);
    expect(filterStore.hasFilters(LAYER_A)).toBe(false);
  });

  it('add() appends a filter', () => {
    filterStore.add(LAYER_A, { field: 'name', operator: 'eq', value: 'Paris' });
    expect(filterStore.get(LAYER_A)).toHaveLength(1);
    expect(filterStore.hasFilters(LAYER_A)).toBe(true);
  });

  it('add() keeps layers independent', () => {
    filterStore.add(LAYER_A, { field: 'a', operator: 'eq', value: '1' });
    filterStore.add(LAYER_B, { field: 'b', operator: 'ne', value: '2' });
    expect(filterStore.get(LAYER_A)).toHaveLength(1);
    expect(filterStore.get(LAYER_B)).toHaveLength(1);
  });

  it('remove() removes the filter at the given index', () => {
    filterStore.add(LAYER_A, { field: 'a', operator: 'eq', value: '1' });
    filterStore.add(LAYER_A, { field: 'b', operator: 'gt', value: '5' });
    filterStore.remove(LAYER_A, 0);
    expect(filterStore.get(LAYER_A)).toHaveLength(1);
    expect(filterStore.get(LAYER_A)[0]?.field).toBe('b');
  });

  it('clear() removes all filters for that layer only', () => {
    filterStore.add(LAYER_A, { field: 'a', operator: 'eq', value: '1' });
    filterStore.add(LAYER_B, { field: 'b', operator: 'eq', value: '2' });
    filterStore.clear(LAYER_A);
    expect(filterStore.get(LAYER_A)).toHaveLength(0);
    expect(filterStore.get(LAYER_B)).toHaveLength(1);
  });
});

describe('filterStore.toMapLibreFilter()', () => {
  // NOTE: The real fslFiltersToMapLibre expression shape is thoroughly tested in
  // packages/geo-engine/src/__tests__/filters.test.ts (all operators + compound + error cases).
  // These tests verify the store correctly delegates to that function and returns the expected shape.
  beforeEach(() => filterStore.clear(LAYER_A));

  it('returns undefined when no filters are set', () => {
    expect(filterStore.toMapLibreFilter(LAYER_A)).toBeUndefined();
  });

  it('returns a single MapLibre comparison expression for one filter', () => {
    filterStore.add(LAYER_A, { field: 'name', operator: 'eq', value: 'Paris' });
    const filter = filterStore.toMapLibreFilter(LAYER_A);
    // Mock produces ['==', ['get', 'name'], 'Paris'] for a single filter
    expect(filter).toEqual(['==', ['get', 'name'], 'Paris']);
  });

  it('wraps multiple filters in an "all" expression', () => {
    filterStore.add(LAYER_A, { field: 'name', operator: 'eq', value: 'Paris' });
    filterStore.add(LAYER_A, { field: 'pop', operator: 'eq', value: '1000' });
    const filter = filterStore.toMapLibreFilter(LAYER_A);
    // Mock produces ['all', ...] when multiple filters are present
    expect(Array.isArray(filter)).toBe(true);
    expect((filter as unknown[])[0]).toBe('all');
    expect((filter as unknown[]).length).toBe(3);
  });
});

describe('filterStore.applyToFeatures() — operator coverage', () => {
  beforeEach(() => filterStore.clear(LAYER_A));

  const features = [
    makeFeature('1', { city: 'Paris',  pop: 2_100_000, tag: 'capital,eu' }),
    makeFeature('2', { city: 'Lyon',   pop:   500_000, tag: 'eu' }),
    makeFeature('3', { city: 'Tokyo',  pop: 14_000_000, tag: 'capital,asia' }),
    makeFeature('4', { city: 'Osaka',  pop:  2_700_000, tag: 'asia' }),
  ];

  it('eq: returns matching features', () => {
    filterStore.add(LAYER_A, { field: 'city', operator: 'eq', value: 'Paris' });
    const result = filterStore.applyToFeatures(LAYER_A, features);
    expect(result).toHaveLength(1);
    expect(result[0]?.properties?.['city']).toBe('Paris');
  });

  it('ne: excludes matching features', () => {
    filterStore.add(LAYER_A, { field: 'city', operator: 'ne', value: 'Paris' });
    const result = filterStore.applyToFeatures(LAYER_A, features);
    expect(result).toHaveLength(3);
    expect(result.every((f) => f.properties?.['city'] !== 'Paris')).toBe(true);
  });

  it('lt: returns features below numeric threshold', () => {
    filterStore.add(LAYER_A, { field: 'pop', operator: 'lt', value: '1000000' });
    const result = filterStore.applyToFeatures(LAYER_A, features);
    expect(result).toHaveLength(1);
    expect(result[0]?.properties?.['city']).toBe('Lyon');
  });

  it('gt: returns features above numeric threshold', () => {
    filterStore.add(LAYER_A, { field: 'pop', operator: 'gt', value: '3000000' });
    const result = filterStore.applyToFeatures(LAYER_A, features);
    expect(result).toHaveLength(1);
    expect(result[0]?.properties?.['city']).toBe('Tokyo');
  });

  it('cn: case-insensitive substring match', () => {
    filterStore.add(LAYER_A, { field: 'city', operator: 'cn', value: 'yon' });
    const result = filterStore.applyToFeatures(LAYER_A, features);
    expect(result).toHaveLength(1);
    expect(result[0]?.properties?.['city']).toBe('Lyon');
  });

  it('in: returns features whose value is in the comma-separated list', () => {
    filterStore.add(LAYER_A, { field: 'city', operator: 'in', value: 'Paris, Tokyo' });
    const result = filterStore.applyToFeatures(LAYER_A, features);
    expect(result).toHaveLength(2);
  });

  it('ni: returns features whose value is NOT in the list', () => {
    filterStore.add(LAYER_A, { field: 'city', operator: 'ni', value: 'Paris, Lyon' });
    const result = filterStore.applyToFeatures(LAYER_A, features);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.properties?.['city'])).toEqual(['Tokyo', 'Osaka']);
  });

  it('multiple filters are ANDed together', () => {
    filterStore.add(LAYER_A, { field: 'tag', operator: 'cn', value: 'capital' });
    filterStore.add(LAYER_A, { field: 'pop', operator: 'lt', value: '5000000' });
    const result = filterStore.applyToFeatures(LAYER_A, features);
    // capitals: Paris (2.1M) + Tokyo (14M) → only Paris passes pop < 5M
    expect(result).toHaveLength(1);
    expect(result[0]?.properties?.['city']).toBe('Paris');
  });

  it('returns all features unmodified when no filters are active', () => {
    const result = filterStore.applyToFeatures(LAYER_A, features);
    expect(result).toHaveLength(features.length);
  });

  it('returns empty array when no features match', () => {
    filterStore.add(LAYER_A, { field: 'city', operator: 'eq', value: 'Berlin' });
    expect(filterStore.applyToFeatures(LAYER_A, features)).toHaveLength(0);
  });
});

// ─── localStorage persistence ────────────────────────────────────────────────

const MAP_ID = 'map-test-123';
const STORAGE_KEY = `felt-filters-${MAP_ID}`;

describe('saveFilters / loadFilters', () => {
  beforeEach(() => {
    filterStore.clear(LAYER_A);
    filterStore.clear(LAYER_B);
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('saveFilters persists active filters to localStorage', () => {
    filterStore.add(LAYER_A, { field: 'city', operator: 'eq', value: 'Paris' });
    saveFilters(MAP_ID);
    const raw = localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(parsed[LAYER_A]).toHaveLength(1);
    expect(parsed[LAYER_A][0].value).toBe('Paris');
  });

  it('saveFilters removes the key when no filters remain', () => {
    filterStore.add(LAYER_A, { field: 'city', operator: 'eq', value: 'Paris' });
    saveFilters(MAP_ID);
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();

    filterStore.clear(LAYER_A);
    saveFilters(MAP_ID);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('saveFilters does not write empty layers', () => {
    filterStore.clear(LAYER_A); // explicitly empty
    filterStore.add(LAYER_B, { field: 'pop', operator: 'gt', value: '1000' });
    saveFilters(MAP_ID);
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(Object.keys(parsed)).not.toContain(LAYER_A);
    expect(parsed[LAYER_B]).toHaveLength(1);
  });

  it('loadFilters restores persisted filters into the store', () => {
    filterStore.add(LAYER_A, { field: 'name', operator: 'cn', value: 'ar' });
    filterStore.add(LAYER_B, { field: 'pop', operator: 'lt', value: '500' });
    saveFilters(MAP_ID);

    // Reset store state
    filterStore.clear(LAYER_A);
    filterStore.clear(LAYER_B);
    expect(filterStore.hasFilters(LAYER_A)).toBe(false);

    loadFilters(MAP_ID);
    expect(filterStore.get(LAYER_A)).toHaveLength(1);
    expect(filterStore.get(LAYER_A)[0]?.field).toBe('name');
    expect(filterStore.get(LAYER_B)).toHaveLength(1);
  });

  it('loadFilters is a no-op when no key exists', () => {
    loadFilters('nonexistent-map');
    expect(filterStore.get(LAYER_A)).toHaveLength(0);
  });

  it('loadFilters silently ignores corrupt JSON', () => {
    localStorage.setItem(STORAGE_KEY, '{broken json{{');
    expect(() => loadFilters(MAP_ID)).not.toThrow();
    expect(filterStore.get(LAYER_A)).toHaveLength(0);
  });

  it('saveFilters scopes storage by map ID — different maps are independent', () => {
    const OTHER_MAP = 'map-other-456';
    filterStore.add(LAYER_A, { field: 'city', operator: 'eq', value: 'Tokyo' });
    saveFilters(MAP_ID);

    filterStore.clear(LAYER_A);
    filterStore.add(LAYER_A, { field: 'city', operator: 'eq', value: 'Berlin' });
    saveFilters(OTHER_MAP);

    const parsedA = JSON.parse(localStorage.getItem(`felt-filters-${MAP_ID}`)!);
    const parsedB = JSON.parse(localStorage.getItem(`felt-filters-${OTHER_MAP}`)!);
    expect(parsedA[LAYER_A][0].value).toBe('Tokyo');
    expect(parsedB[LAYER_A][0].value).toBe('Berlin');
  });
});
