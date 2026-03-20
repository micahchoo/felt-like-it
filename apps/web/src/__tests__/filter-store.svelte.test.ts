import { describe, it, expect, beforeEach } from 'vitest';
import { filterStore } from '$lib/stores/filters.svelte.js';

// Reset internal state between tests by clearing all known layer IDs
const LAYER = 'test-layer';

describe('filterStore.get()', () => {
  beforeEach(() => {
    // Clear filters for test layer before each test
    filterStore.clear(LAYER);
  });

  it('returns a copy, not the internal reference', () => {
    filterStore.add(LAYER, { field: 'name', operator: 'eq', value: 'test' });
    const result = filterStore.get(LAYER);
    // Mutate the returned array — internal state must not change
    result.push({ field: 'hack', operator: 'eq', value: 'injected' });
    expect(filterStore.get(LAYER)).toHaveLength(1);
  });

  it('returns empty array (not undefined) when layer has no filters', () => {
    expect(filterStore.get('nonexistent-layer')).toEqual([]);
  });

  it('returned array mutation does not affect subsequent get() calls', () => {
    filterStore.add(LAYER, { field: 'a', operator: 'eq', value: '1' });
    filterStore.add(LAYER, { field: 'b', operator: 'eq', value: '2' });
    const first = filterStore.get(LAYER);
    first.length = 0; // truncate via mutation
    expect(filterStore.get(LAYER)).toHaveLength(2);
  });
});
