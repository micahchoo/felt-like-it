/* global AbortController */

// ─── Types ───────────────────────────────────────────────────────────────────

export type ViewportSortBy = 'created_at' | 'updated_at' | 'id';
export type ViewportSortDir = 'asc' | 'desc';
export type ViewportRow = { id: string; properties: Record<string, unknown>; geometryType: string };

export interface ViewportFetchParams {
  layerId: string;
  bbox: [number, number, number, number];
  limit: number;
  offset: number;
  sortBy: ViewportSortBy;
  sortDir: ViewportSortDir;
}

export interface ViewportFetchResult {
  rows: ViewportRow[];
  total: number;
}

export interface ViewportDeps {
  fetchFn: (params: ViewportFetchParams) => Promise<ViewportFetchResult>;
  getActiveLayer: () => { id: string } | null;
  isLargeLayer: (layer: { id: string }) => boolean;
  getMap: () => { getBounds: () => { getWest(): number; getSouth(): number; getEast(): number; getNorth(): number } } | undefined;
  onError?: (err: unknown) => void;
}

// ─── Store factory ───────────────────────────────────────────────────────────

export function createViewportStore(deps: ViewportDeps) {
  // State
  let rows = $state<ViewportRow[]>([]);
  let total = $state(0);
  let page = $state(1);
  let pageSize = $state(50);
  let sortBy = $state<ViewportSortBy>('created_at');
  let sortDir = $state<ViewportSortDir>('asc');
  let loading = $state(false);

  // Internal (not $state — not reactive, just mutable)
  let abortController: AbortController | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  async function fetch() {
    const activeLayer = deps.getActiveLayer();
    if (!activeLayer || !deps.isLargeLayer(activeLayer)) return;

    const map = deps.getMap();
    if (!map) return;

    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];

    abortController?.abort();
    const controller = new AbortController();
    abortController = controller;

    loading = true;
    try {
      const result = await deps.fetchFn({
        layerId: activeLayer.id,
        bbox,
        limit: pageSize,
        offset: (page - 1) * pageSize,
        sortBy,
        sortDir,
      });
      if (!controller.signal.aborted) {
        rows = result.rows;
        total = result.total;
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      deps.onError?.(err);
    } finally {
      loading = false;
    }
  }

  function handleMoveEnd() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      page = 1;
      fetch();
    }, 300);
  }

  function changePage(newPage: number) {
    page = newPage;
    fetch();
  }

  function changePageSize(newSize: number) {
    pageSize = newSize;
    page = 1;
    fetch();
  }

  function changeSortBy(newSortBy: string, newSortDir: ViewportSortDir) {
    sortBy = newSortBy as ViewportSortBy;
    sortDir = newSortDir;
    page = 1;
    fetch();
  }

  /**
   * Attach the moveend listener to a MapLibre map instance.
   * Returns a cleanup function that removes the listener and cancels pending debounce.
   * Wire into the component's $effect lifecycle.
   */
  function bindMap(map: { on: (event: string, fn: () => void) => void; off: (event: string, fn: () => void) => void }) {
    map.on('moveend', handleMoveEnd);
    // Initial fetch for current viewport
    fetch();

    return () => {
      map.off('moveend', handleMoveEnd);
      clearTimeout(debounceTimer);
    };
  }

  return {
    get rows() { return rows; },
    get total() { return total; },
    get page() { return page; },
    get pageSize() { return pageSize; },
    get sortBy() { return sortBy; },
    get sortDir() { return sortDir; },
    get loading() { return loading; },
    fetch,
    handleMoveEnd,
    changePage,
    changePageSize,
    changeSortBy,
    bindMap,
  };
}
