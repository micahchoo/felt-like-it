import { effectEnter, effectExit } from '$lib/debug/effect-tracker.js';
import { untrack } from 'svelte';
import type { Layer, GeoJSONFeature } from '@felt-like-it/shared-types';
import type { QueryClient } from '@tanstack/svelte-query';

// ── Types ───────────────────────────────────────────────────────────────────

export type FeatureCollection = { type: 'FeatureCollection'; features: GeoJSONFeature[] };

export interface LayerDataManagerDeps {
  getInitialLayers: () => Layer[];
  queryClient: QueryClient;
  queryKeysFn: (layerId: string) => unknown[];
  fetchLayerFn: (layerId: string) => Promise<unknown>;
  isLargeLayer: (layer: Layer) => boolean;
  getMapInstance: () => import('maplibre-gl').Map | undefined;
  layersStore: {
    set: (layers: Layer[]) => void;
    readonly active: Layer | null;
  };
  onError: (msg: string) => void;
}

// ── Guard ───────────────────────────────────────────────────────────────────

/**
 * TYPE_DEBT: features.list returns geometry as Record<string, unknown> from raw SQL;
 * the actual runtime shape is always a valid GeoJSON FeatureCollection. This guard
 * validates the structural contract so we can narrow without a double cast.
 */
function isFeatureCollection(
  data: unknown
): data is FeatureCollection {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as Record<string, unknown>)['type'] === 'FeatureCollection' &&
    Array.isArray((data as Record<string, unknown>)['features'])
  );
}

// ── Composable ──────────────────────────────────────────────────────────────

export function useLayerDataManager(deps: LayerDataManagerDeps) {
  let layerData = $state<Record<string, FeatureCollection>>({});
  const loadGeneration: Record<string, number> = {};
  const loadingLayers = new Set<string>();

  async function loadLayerData(layerId: string) {
    if (loadingLayers.has(layerId)) return;
    loadingLayers.add(layerId);
    const gen = (loadGeneration[layerId] = (loadGeneration[layerId] ?? 0) + 1);
    try {
      // Use the TanStack Query cache so that invalidations from DrawingToolbar
      // (and any other mutating component) automatically cause a re-fetch here.
      // fetchQuery re-fetches when the entry is stale or missing; returns cached
      // data when fresh — eliminating the dual-path bypass of the query cache.
      const fc = await deps.queryClient.fetchQuery({
        queryKey: deps.queryKeysFn(layerId),
        queryFn: () => deps.fetchLayerFn(layerId),
      });
      if (gen !== loadGeneration[layerId]) return; // stale — newer load in progress
      if (!isFeatureCollection(fc)) {
        throw new Error(`Unexpected response shape from features.list for layer ${layerId}`);
      }
      layerData = { ...layerData, [layerId]: fc };

      // WORKAROUND: svelte-maplibre-gl's RawSource has a `firstRun` guard on its
      // GeoJSON data $effect — it only calls `setData` when `!firstRun`, and
      // `firstRun` is set to false only after the source binding settles (via a
      // separate `$effect(() => { source; firstRun = false; })`). Because layer
      // data is fetched asynchronously after mount, the data-update effect fires
      // while `firstRun` is still true for the first arrival, so the declarative
      // `data` prop alone silently drops the initial payload. The imperative call
      // below guarantees the first fetch always reaches the MapLibre source.
      // Checked against svelte-maplibre-gl dist/sources/RawSource.svelte — guard
      // still present. Remove this block if the library ever fixes initial setData.
      const map = deps.getMapInstance();
      const src = map?.getSource(`source-${layerId}`);
      if (src && 'setData' in src) {
        (src as { setData: (_data: unknown) => void }).setData(fc);
      }
    } catch (err) {
      if (gen !== loadGeneration[layerId]) return;
      console.error('[loadLayerData] failed:', err);
      deps.onError('Failed to load data for layer.');
    } finally {
      loadingLayers.delete(layerId);
    }
  }

  async function handleLayerChange() {
    const activeLayer = deps.layersStore.active;
    if (!activeLayer) return;
    if (deps.isLargeLayer(activeLayer)) return; // vector tiles handle rendering
    if (!layerData[activeLayer.id]) {
      await loadLayerData(activeLayer.id);
    }
  }

  // Initialize layers on mount
  $effect(() => {
    const layers = deps.getInitialLayers();
    effectEnter('ME:initLayers', { count: layers.length });
    untrack(() => {
      deps.layersStore.set(layers);
      for (const layer of layers) {
        if (!deps.isLargeLayer(layer)) {
          loadLayerData(layer.id);
        }
      }
    });
    effectExit('ME:initLayers');
  });

  return {
    get layerData() { return layerData; },
    loadLayerData,
    handleLayerChange,
  };
}
