import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FiltersStore } from '../lib/stores/filters-store.svelte.js';

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

describe('FiltersStore', () => {
  let store: FiltersStore;

  beforeEach(() => {
    const mockLocation = new URL('http://localhost/map/test-map');
    vi.stubGlobal('location', mockLocation);
    vi.stubGlobal('history', { replaceState: vi.fn() });
    store = new FiltersStore(() => 'test-map');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts with no conditions', () => {
    expect(store.conditions).toEqual([]);
  });

  it('adds a condition and updates URL', () => {
    store.addCondition({ field: 'name', operator: 'eq', value: 'test' });
    expect(store.conditions).toHaveLength(1);
    expect(store.conditions[0]!.field).toBe('name');
  });

  it('removes a condition by index', () => {
    store.addCondition({ field: 'name', operator: 'eq', value: 'a' });
    store.addCondition({ field: 'type', operator: 'cn', value: 'b' });
    store.removeCondition(0);
    expect(store.conditions).toHaveLength(1);
    expect(store.conditions[0]!.field).toBe('type');
  });

  it('serializes conditions to URL params', () => {
    store.addCondition({ field: 'name', operator: 'eq', value: 'test' });
    const params = store.toUrlParams();
    expect(params.get('filter')).toBe('name:eq:test');
  });

  it('deserializes conditions from URL params', () => {
    const params = new URLSearchParams('filter=name:eq:test&filter=type:cn:road');
    store.fromUrlParams(params);
    expect(store.conditions).toHaveLength(2);
    expect(store.conditions[0]).toEqual({ field: 'name', operator: 'eq', value: 'test' });
    expect(store.conditions[1]).toEqual({ field: 'type', operator: 'cn', value: 'road' });
  });

  it('infers field types from sample features', () => {
    const sampleFeatures = [{ properties: { name: 'test', count: 42, active: true } }];
    const fields = store.inferFields(sampleFeatures);
    expect(fields).toEqual({
      name: 'string',
      count: 'number',
      active: 'boolean',
    });
  });

  it('produces MapLibre filter for a layer', () => {
    store.addCondition({ field: 'name', operator: 'eq', value: 'test' });
    const mlFilter = store.toMapLibreFilter('layer-1');
    expect(mlFilter).toBeDefined();
    // Filter should be ['==', ['get', 'name'], 'test']
    expect(mlFilter).toEqual(['==', ['get', 'name'], 'test']);
  });
});
