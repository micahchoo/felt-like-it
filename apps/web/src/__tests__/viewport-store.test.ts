// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createViewportStore } from '../lib/stores/viewport.svelte.js';
import type { ViewportDeps, ViewportFetchParams, ViewportFetchResult } from '../lib/stores/viewport.svelte.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeBounds() {
  return {
    getWest: () => -180,
    getSouth: () => -90,
    getEast: () => 180,
    getNorth: () => 90,
  };
}

function makeMap() {
  const listeners: Record<string, (() => void)[]> = {};
  return {
    on(event: string, fn: () => void) {
      listeners[event] = listeners[event] ?? [];
      listeners[event].push(fn);
    },
    off(event: string, fn: () => void) {
      listeners[event] = (listeners[event] ?? []).filter((f) => f !== fn);
    },
    emit(event: string) {
      (listeners[event] ?? []).forEach((fn) => fn());
    },
    getBounds: () => makeBounds(),
  };
}

function makeDeps(overrides: Partial<ViewportDeps> = {}): ViewportDeps & { fetchFn: ReturnType<typeof vi.fn> } {
  const fetchFn = vi.fn<[ViewportFetchParams], Promise<ViewportFetchResult>>().mockResolvedValue({ rows: [], total: 0 });
  return {
    fetchFn,
    getActiveLayer: () => ({ id: 'layer-1' }),
    isLargeLayer: () => true,
    getMap: () => makeMap(),
    onError: vi.fn(),
    ...overrides,
    fetchFn: overrides.fetchFn as typeof fetchFn ?? fetchFn,
  };
}

// ─── Default state ────────────────────────────────────────────────────────────

describe('createViewportStore — default state', () => {
  it('starts at page 1', () => {
    const store = createViewportStore(makeDeps());
    expect(store.page).toBe(1);
  });

  it('starts with pageSize 50', () => {
    const store = createViewportStore(makeDeps());
    expect(store.pageSize).toBe(50);
  });

  it('starts with empty rows', () => {
    const store = createViewportStore(makeDeps());
    expect(store.rows).toEqual([]);
  });

  it('starts with total 0', () => {
    const store = createViewportStore(makeDeps());
    expect(store.total).toBe(0);
  });

  it('starts not loading', () => {
    const store = createViewportStore(makeDeps());
    expect(store.loading).toBe(false);
  });

  it('starts with sortBy created_at asc', () => {
    const store = createViewportStore(makeDeps());
    expect(store.sortBy).toBe('created_at');
    expect(store.sortDir).toBe('asc');
  });
});

// ─── changePage ───────────────────────────────────────────────────────────────

describe('changePage', () => {
  it('updates page to the given value', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.changePage(3);
    expect(store.page).toBe(3);
  });

  it('calls fetch after changing page', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.changePage(2);
    await Promise.resolve(); // flush microtask
    expect(deps.fetchFn).toHaveBeenCalledOnce();
  });

  it('passes correct offset to fetchFn based on page × pageSize', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.changePage(3); // page 3 of 50 → offset = 100
    await Promise.resolve();
    const call = deps.fetchFn.mock.calls[0][0];
    expect(call.offset).toBe((3 - 1) * 50);
  });
});

// ─── changePageSize ───────────────────────────────────────────────────────────

describe('changePageSize', () => {
  it('updates pageSize', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.changePageSize(100);
    expect(store.pageSize).toBe(100);
  });

  it('resets page to 1 on size change', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.changePage(5);
    store.changePageSize(25);
    expect(store.page).toBe(1);
  });

  it('calls fetch after resetting page', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.changePage(5);
    deps.fetchFn.mockClear();
    store.changePageSize(25);
    await Promise.resolve();
    expect(deps.fetchFn).toHaveBeenCalledOnce();
  });
});

// ─── changeSortBy ─────────────────────────────────────────────────────────────

describe('changeSortBy', () => {
  it('updates sortBy and sortDir', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.changeSortBy('updated_at', 'desc');
    expect(store.sortBy).toBe('updated_at');
    expect(store.sortDir).toBe('desc');
  });

  it('resets page to 1 on sort change', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.changePage(4);
    store.changeSortBy('id', 'asc');
    expect(store.page).toBe(1);
  });
});

// ─── handleMoveEnd debounce ───────────────────────────────────────────────────

describe('handleMoveEnd — debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('does not call fetch immediately', () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.handleMoveEnd();
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it('calls fetch after 300ms debounce', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.handleMoveEnd();
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    expect(deps.fetchFn).toHaveBeenCalledOnce();
  });

  it('coalesces multiple rapid moveEnd calls into one fetch', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.handleMoveEnd();
    store.handleMoveEnd();
    store.handleMoveEnd();
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    expect(deps.fetchFn).toHaveBeenCalledOnce();
  });

  it('resets page to 1 on moveEnd', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    store.changePage(5);
    deps.fetchFn.mockClear();
    store.handleMoveEnd();
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    expect(store.page).toBe(1);
  });
});

// ─── Abort on new fetch ───────────────────────────────────────────────────────

describe('fetch — abort on new request', () => {
  it('aborts an in-flight request when a second fetch starts', async () => {
    let resolveFirst!: (v: ViewportFetchResult) => void;
    const firstFetch = new Promise<ViewportFetchResult>((res) => { resolveFirst = res; });

    const deps = makeDeps({
      fetchFn: vi.fn()
        .mockReturnValueOnce(firstFetch) // first call hangs
        .mockResolvedValue({ rows: [{ id: 'r2', properties: {}, geometryType: 'Point' }], total: 1 }),
    });

    const store = createViewportStore(deps);

    // Start first fetch (hangs)
    store.changePage(1);

    // Start second fetch while first is pending
    store.changePage(2);
    await Promise.resolve();

    // Resolve first fetch — its result should be discarded because it was aborted
    resolveFirst({ rows: [{ id: 'r1', properties: {}, geometryType: 'Point' }], total: 99 });
    await Promise.resolve();

    // The second fetch's result should win
    expect(store.total).toBe(1);
    expect(store.rows).toEqual([{ id: 'r2', properties: {}, geometryType: 'Point' }]);
  });
});

// ─── No-op cases ─────────────────────────────────────────────────────────────

describe('fetch — no-op guards', () => {
  it('does nothing when there is no active layer', async () => {
    const deps = makeDeps({ getActiveLayer: () => null });
    const store = createViewportStore(deps);
    store.changePage(2);
    await Promise.resolve();
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it('does nothing when the layer is not a large layer', async () => {
    const deps = makeDeps({ isLargeLayer: () => false });
    const store = createViewportStore(deps);
    store.changePage(2);
    await Promise.resolve();
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });

  it('does nothing when the map instance is unavailable', async () => {
    const deps = makeDeps({ getMap: () => undefined });
    const store = createViewportStore(deps);
    store.changePage(2);
    await Promise.resolve();
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });
});

// ─── bindMap lifecycle ────────────────────────────────────────────────────────

describe('bindMap', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('attaches moveend listener and triggers initial fetch', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    const map = makeMap();
    store.bindMap(map);
    await Promise.resolve();
    expect(deps.fetchFn).toHaveBeenCalledOnce();
  });

  it('cleanup function removes moveend listener', async () => {
    const deps = makeDeps();
    const store = createViewportStore(deps);
    const map = makeMap();
    const cleanup = store.bindMap(map);
    await Promise.resolve();
    deps.fetchFn.mockClear();

    cleanup();
    // After cleanup, emitting moveend should not trigger another fetch
    map.emit('moveend');
    vi.advanceTimersByTime(300);
    await Promise.resolve();
    expect(deps.fetchFn).not.toHaveBeenCalled();
  });
});
