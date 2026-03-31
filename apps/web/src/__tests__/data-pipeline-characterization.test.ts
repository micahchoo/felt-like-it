// @vitest-environment node
/**
 * Characterization tests for the data pipeline code paths that will be modified.
 *
 * These tests capture CURRENT behavior before we change it:
 * - Upload endpoint: Buffer.from(await file.arrayBuffer()) → streaming
 * - Filter store: singleton per-layer API → FiltersStore class
 * - Geoprocessing router: sync runGeoprocessing → async job enqueue
 *
 * When these tests start FAILING, it means we've successfully changed the behavior.
 * They serve as a regression safety net — the NEW behavior should have its own tests.
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// ─── 1. Upload endpoint characterization ─────────────────────────────────────
// Current behavior: uses Buffer.from(await file.arrayBuffer()) to write file to disk
// This test characterizes that the endpoint exists and has the expected structure.

describe('Upload endpoint (current behavior — streaming)', () => {
  it('upload endpoint file exists and exports POST handler', async () => {
    const mod = await import('$lib/../routes/api/upload/+server.js');
    expect(mod.POST).toBeDefined();
    expect(typeof mod.POST).toBe('function');
  });

  it('upload endpoint uses streaming pattern (read source to verify)', async () => {
    // Characterize that the implementation now uses streaming (was Buffer.from)
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/routes/api/upload/+server.ts');
    const source = await fs.readFile(filePath, 'utf-8');
    // New implementation uses file.stream() and createWriteStream
    expect(source).toContain('file.stream()');
    expect(source).toContain('createWriteStream');
    // No longer uses Buffer.from for the entire file
    expect(source).not.toContain('Buffer.from(await file.arrayBuffer())');
    // Size check is now via streaming byte count (bytesWritten)
    expect(source).toContain('bytesWritten');
  });
});

// ─── 2. Filter store singleton characterization ──────────────────────────────
// Current behavior: module-level singleton with per-layer API
// filterStore.get(layerId), filterStore.add(layerId, filter), etc.
// This is being replaced by FiltersStore class with map-scoped instances.

describe('Filter store singleton (current behavior)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let filterStore: any;

  beforeAll(async () => {
    const mod = await import('$lib/stores/filters.svelte.js');
    filterStore = mod.filterStore;
  });

  it('filterStore is a singleton object with known methods', () => {
    expect(typeof filterStore).toBe('object');
    expect(typeof filterStore.get).toBe('function');
    expect(typeof filterStore.add).toBe('function');
    expect(typeof filterStore.remove).toBe('function');
    expect(typeof filterStore.clear).toBe('function');
    expect(typeof filterStore.hasFilters).toBe('function');
    expect(typeof filterStore.toMapLibreFilter).toBe('function');
    expect(typeof filterStore.applyToFeatures).toBe('function');
  });

  it('filterStore.get returns empty array for unknown layer', () => {
    expect(filterStore.get('nonexistent-layer')).toEqual([]);
  });

  it('filterStore.add/Get/remove work per-layer', () => {
    const layerA = 'char-layer-a';
    const layerB = 'char-layer-b';

    filterStore.add(layerA, { field: 'name', operator: 'eq', value: 'test' });
    expect(filterStore.get(layerA)).toHaveLength(1);
    expect(filterStore.get(layerB)).toEqual([]);

    filterStore.remove(layerA, 0);
    expect(filterStore.get(layerA)).toEqual([]);
  });

  it('filterStore.clear removes all filters for a layer', () => {
    const layer = 'char-layer-clear';
    filterStore.add(layer, { field: 'a', operator: 'eq', value: '1' });
    filterStore.add(layer, { field: 'b', operator: 'eq', value: '2' });
    expect(filterStore.get(layer)).toHaveLength(2);

    filterStore.clear(layer);
    expect(filterStore.get(layer)).toEqual([]);
  });

  it('filterStore.toMapLibreFilter returns undefined when no filters', () => {
    const layer = 'char-layer-ml';
    filterStore.clear(layer);
    expect(filterStore.toMapLibreFilter(layer)).toBeUndefined();
  });

  it('filterStore.applyToFeatures filters features correctly', () => {
    const layer = 'char-layer-apply';
    filterStore.clear(layer);
    filterStore.add(layer, { field: 'type', operator: 'eq', value: 'park' });

    const features = [{ properties: { type: 'park' } }, { properties: { type: 'school' } }];

    const filtered = filterStore.applyToFeatures(layer, features as any);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.properties?.type).toBe('park');
  });

  it('filterStore.hasFilters returns true when filters exist', () => {
    const layer = 'char-layer-has';
    filterStore.clear(layer);
    expect(filterStore.hasFilters(layer)).toBe(false);

    filterStore.add(layer, { field: 'x', operator: 'eq', value: 'y' });
    expect(filterStore.hasFilters(layer)).toBe(true);
  });
});

// ─── 3. Geoprocessing router characterization ────────────────────────────────
// Current behavior: synchronous execution — calls runGeoprocessing directly
// This is being changed to async job enqueue via BullMQ.

describe('Geoprocessing router (current behavior — synchronous)', () => {
  it('geoprocessing router file exists and exports router', async () => {
    const mod = await import('$lib/server/trpc/routers/geoprocessing.js');
    expect(mod.geoprocessingRouter).toBeDefined();
  });

  it('geoprocessing router source enqueues async job (read source)', async () => {
    // After F08 async geoprocessing: router enqueues job instead of sync execution
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/lib/server/trpc/routers/geoprocessing.ts');
    const source = await fs.readFile(filePath, 'utf-8');

    // Implementation enqueues job and returns jobId
    expect(source).toContain('enqueueGeoprocessingJob');
    expect(source).toContain('jobId');
    // No longer calls runGeoprocessing directly
    expect(source).not.toContain('runGeoprocessing');
  });
});
