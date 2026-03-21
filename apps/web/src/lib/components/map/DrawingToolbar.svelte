<script lang="ts">
  import { untrack } from 'svelte';
  import type { Map as MapLibreMap } from 'maplibre-gl';
  import { effectEnter, effectExit } from '$lib/debug/effect-tracker.js';
  import { selectionStore } from '$lib/stores/selection.svelte.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { undoStore } from '$lib/stores/undo.svelte.js';
  import { drawingStore } from '$lib/stores/drawing.svelte.js';
  import { trpc } from '$lib/utils/trpc.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import { MousePointer2, Circle, Spline, Pentagon } from 'lucide-svelte';
  import type { DrawTool } from '$lib/stores/selection.svelte.js';
  import { measureLine, measurePolygon } from '@felt-like-it/geo-engine';
  import type { MeasurementResult } from '@felt-like-it/geo-engine';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { queryKeys } from '$lib/utils/query-keys.js';
  import { hotOverlay } from '$lib/utils/map-sources.svelte.js';
  import type { GeoJSONStoreFeatures } from 'terra-draw';

  interface Props {
    map: MapLibreMap;
    onfeaturedrawn?: ((_layerId: string, _feature: Record<string, unknown> & { id?: string | undefined }) => void) | undefined;
    /**
     * When provided, the drawing toolbar enters measurement mode: drawn features
     * are NOT saved to any layer — instead, the computed measurement is passed
     * to this callback.  The caller is responsible for displaying the result.
     */
    onmeasured?: ((_result: MeasurementResult) => void) | undefined;
    /**
     * When provided, the next drawn polygon is captured as an annotation region
     * instead of being saved to a layer. The callback receives the polygon geometry.
     * Automatically clears after one polygon is captured.
     */
    onregiondrawn?: ((_geometry: { type: 'Polygon'; coordinates: number[][][] }) => void) | undefined;
  }

  let { map, onfeaturedrawn, onmeasured, onregiondrawn }: Props = $props();

  const queryClient = useQueryClient();

  const featureUpsertMutation = createMutation(() => ({
    mutationFn: ((input: { layerId: string; features: { geometry: Record<string, unknown>; properties: Record<string, unknown> }[] }) =>
      trpc.features.upsert.mutate(input)) as any,
    onSuccess: (_data: { upsertedIds: string[] }, variables: { layerId: string }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.features.list({ layerId: variables.layerId }) });
    },
  }));

  const featureDeleteMutation = createMutation(() => ({
    mutationFn: ((input: { layerId: string; ids: string[] }) =>
      trpc.features.delete.mutate(input)) as any,
    onSuccess: (_data: unknown, variables: { layerId: string }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.features.list({ layerId: variables.layerId }) });
    },
  }));

  $effect(() => {
    effectEnter('DT:initTerraDraw', { hasMap: !!map });
    if (!map) { effectExit('DT:initTerraDraw'); return; }

    function startDraw() {
      // untrack: reset()/init() read _state internally (for guards) but this
      // effect should only track the `map` prop — not drawingStore reactive state.
      // Without untrack, reset()'s `if (_state.status === 'ready')` check creates
      // a tracked dependency on _state, and each new { status: 'idle' } object
      // re-triggers this effect → infinite loop with syncToolToTerraDraw.
      untrack(() => drawingStore.reset());
      drawingStore.init(map).then((draw) => {
        if (!draw) return;

        draw.on('finish', async (id: string | number) => {
          if (!drawingStore.instance) return;

          const f = drawingStore.instance.getSnapshotFeature(id);

          if (f) {
            if (onregiondrawn && f.geometry.type === 'Polygon') {
              // Annotation region mode — pass geometry to parent; do NOT persist to DB
              onregiondrawn(f.geometry as { type: 'Polygon'; coordinates: number[][][] });
            } else if (onmeasured) {
              // Measurement mode — compute result and notify parent; do NOT persist to DB
              measureFeature(f);
            } else {
              await saveFeature(f);
            }
          }

          // Re-check: component may have unmounted during the async save
          if (!drawingStore.instance) return;

          // Always remove the drawn feature from Terra Draw's overlay.
          // Saved features are re-rendered via the GeoJSON source; unsaved
          // orphans must be cleared or they corrupt subsequent draw operations.
          try {
            drawingStore.instance.removeFeatures([id]);
          } catch (e) {
            console.warn('[TerraDraw] removeFeatures failed:', e);
          }

          // Reset to select mode after drawing
          drawingStore.instance.setMode('select');
          selectionStore.setActiveTool('select');
        });
      }).catch((err) => {
        console.error('TerraDraw init failed:', err);
        toastStore.error('Drawing tools failed to load. Try refreshing.');
      });
    }

    // If style is already loaded (common when navigating to the page), start immediately.
    // map.on('style.load') handles: initial load (if not ready yet) + every basemap swap.
    // Terra Draw's sources/layers are wiped on style reload, so we must re-init each time.
    if (map.isStyleLoaded()) {
      startDraw();
    }
    function onStyleLoad() {
      startDraw();
    }
    map.on('style.load', onStyleLoad);

    effectExit('DT:initTerraDraw');
    return () => {
      map.off('style.load', onStyleLoad);
      untrack(() => drawingStore.stop());
    };
  });

  /**
   * Compute a measurement from a drawn GeoJSON feature and pass it to `onmeasured`.
   * Only LineString and Polygon geometries produce a meaningful result.
   */
  function measureFeature(f: GeoJSONStoreFeatures) {
    const geom = f.geometry;
    if (geom.type === 'LineString') {
      onmeasured?.(measureLine(geom.coordinates as [number, number][]));
    } else if (geom.type === 'Polygon') {
      onmeasured?.(measurePolygon(geom.coordinates as [number, number][][]));
    }
    // Point geometry has no length/area — silently ignore
  }

  async function saveFeature(f: GeoJSONStoreFeatures) {
    const activeLayer = layersStore.active;
    if (!activeLayer) {
      toastStore.error('No active layer. Please create or select a layer first.');
      return;
    }

    // Serialize typed GeoJSON geometry/properties to plain records for the tRPC boundary
    // TYPE_DEBT: GeoJSON geometry interfaces lack index signatures, requiring cast to Record for tRPC schema
    const geometry = f.geometry as unknown as Record<string, unknown>;
    const properties = (f.properties ?? {}) as Record<string, unknown>;

    try {
      const { upsertedIds } = await (featureUpsertMutation as any).mutateAsync({
        layerId: activeLayer.id,
        features: [{ geometry, properties }],
      });

      // Add to hot overlay so the feature is visible immediately for large layers
      // (vector tile sources won't reflect the change until the next tile reload)
      if (upsertedIds[0]) {
        hotOverlay.addHotFeature(activeLayer.id, {
          type: 'Feature',
          id: upsertedIds[0],
          geometry: geometry as unknown as GeoJSON.Geometry,
          properties: properties as GeoJSON.GeoJsonProperties,
        });
      }

      undoStore.push({
        description: `Draw ${f.geometry.type}`,
        undo: async () => {
          if (upsertedIds[0]) {
            await (featureDeleteMutation as any).mutateAsync({ layerId: activeLayer.id, ids: [upsertedIds[0]] });
            hotOverlay.removeHotFeature(activeLayer.id, upsertedIds[0]);
          }
        },
        redo: async () => {
          const result = await (featureUpsertMutation as any).mutateAsync({
            layerId: activeLayer.id,
            features: [{ geometry, properties }],
          });
          if (result.upsertedIds[0]) {
            hotOverlay.addHotFeature(activeLayer.id, {
              type: 'Feature',
              id: result.upsertedIds[0],
              geometry: geometry as unknown as GeoJSON.Geometry,
              properties: properties as GeoJSON.GeoJsonProperties,
            });
          }
        },
      });

      // Await the data reload so the GeoJSON source is updated BEFORE
      // removeFeatures() clears the Terra Draw overlay — no visual gap.
      await onfeaturedrawn?.(activeLayer.id, { geometry, properties, id: upsertedIds[0] });
    } catch (err) {
      // Clean up the orphaned Terra Draw geometry so it doesn't persist visually
      if (drawingStore.instance) {
        try {
          drawingStore.instance.removeFeatures([f.id as any]);
        } catch (_) {
          // Feature may already have been removed — safe to ignore
        }
      }
      console.error('[DrawingToolbar] saveFeature failed:', err);
      toastStore.error('Failed to save drawn feature.');
      try {
        drawingStore.instance?.removeFeatures([f.id as any]);
      } catch (cleanupErr) {
        console.warn('[DrawingToolbar] cleanup after failed save:', cleanupErr);
      }
    }
  }

  // Sync external activeTool changes (e.g. annotation region request) to Terra Draw
  $effect(() => {
    const tool = selectionStore.activeTool;
    effectEnter('DT:syncToolToTerraDraw', { tool, isReady: drawingStore.isReady });
    if (!drawingStore.instance || !drawingStore.isReady) { effectExit('DT:syncToolToTerraDraw'); return; }
    const modeMap: Record<string, string> = { point: 'point', line: 'linestring', polygon: 'polygon', select: 'select' };
    const mode = tool ? modeMap[tool] ?? 'select' : 'select';
    if (drawingStore.instance.getMode() !== mode) {
      // Before switching modes, check for in-progress (unsaved) geometry
      const snapshot = drawingStore.instance.getSnapshot() ?? [];
      // TYPE_DEBT: terra-draw GeoJSONStoreFeatures properties are typed as Record<string,unknown>
      const inProgress = snapshot.filter((f: any) => f.properties?.mode !== 'static');
      if (inProgress.length > 0) {
        // Schedule confirm outside reactive cycle to avoid blocking $effect
        const instance = drawingStore.instance;
        setTimeout(() => {
          const confirmed = window.confirm('You have an unfinished drawing. Discard it?');
          if (!confirmed) return;
          try {
            instance.removeFeatures(inProgress.map((f: any) => f.id!));
          } catch (e) {
            console.warn('[DrawingToolbar] removeFeatures during tool switch failed:', e);
          }
          instance.setMode(mode);
        }, 0);
        effectExit('DT:syncToolToTerraDraw');
        return;
      }
      drawingStore.instance.setMode(mode);
    }
    effectExit('DT:syncToolToTerraDraw');
  });

  // Cancel in-progress drawing on Escape key
  $effect(() => {
    if (!drawingStore.isReady) return;
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        const snapshot = drawingStore.instance?.getSnapshot();
        if (snapshot) {
          // TYPE_DEBT: terra-draw GeoJSONStoreFeatures properties are typed as Record<string,unknown>
          const inProgress = snapshot.filter((f: any) => f.properties?.mode !== 'static');
          if (inProgress.length > 0) {
            try {
              drawingStore.instance?.removeFeatures(inProgress.map((f: any) => f.id!));
            } catch (e) {
              console.warn('[DrawingToolbar] removeFeatures on Escape failed:', e);
            }
          }
        }
        selectionStore.setActiveTool('select');
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });

  /** Check whether Terra Draw is mid-draw (incomplete geometry in progress). */
  function isDrawing(): boolean {
    return drawingStore.instance?.getModeState() === 'drawing';
  }

  /** Cancel the current in-progress drawing and return to select mode. */
  function cancelDrawing() {
    if (!drawingStore.instance) return;
    // Switching to select mode discards any incomplete geometry
    drawingStore.instance.setMode('select');
    selectionStore.setActiveTool('select');
  }

  // Task 2.3: Escape key cancels in-progress drawing
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isDrawing()) {
      e.preventDefault();
      cancelDrawing();
    }
  }

  function setTool(tool: DrawTool) {
    // Task 2.4: Confirm before switching tools if mid-draw
    if (isDrawing()) {
      const discard = window.confirm('You have an unfinished drawing. Discard it?');
      if (!discard) return;
    }

    selectionStore.setActiveTool(tool);
    if (!drawingStore.instance) return;

    switch (tool) {
      case 'point': drawingStore.instance.setMode('point'); break;
      case 'line': drawingStore.instance.setMode('linestring'); break;
      case 'polygon': drawingStore.instance.setMode('polygon'); break;
      case 'select': drawingStore.instance.setMode('select'); break;
      default: drawingStore.instance.setMode('select'); break;
    }
  }

  const tools: Array<{ id: DrawTool; label: string; helpText: string; icon: typeof MousePointer2; group: 'select' | 'draw' }> = [
    { id: 'select', label: 'Select', helpText: 'Click features to view details or take actions', icon: MousePointer2, group: 'select' },
    { id: 'point', label: 'Point', helpText: 'Click to place a point marker on the map', icon: Circle, group: 'draw' },
    { id: 'line', label: 'Line', helpText: 'Click to add vertices, double-click to finish the line', icon: Spline, group: 'draw' },
    { id: 'polygon', label: 'Polygon', helpText: 'Click to add vertices, double-click to close the shape', icon: Pentagon, group: 'draw' },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="absolute top-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 glass-panel rounded-xl px-2 py-1.5 shadow-2xl border border-white/5"
  role="toolbar"
  aria-label="Drawing tools"
>
  {#each tools as tool, i (tool.id)}
    {#if i > 0 && tools[i - 1]?.group !== tool.group}
      <div class="w-px h-6 bg-white/10 mx-1"></div>
    {/if}
    {@const noLayer = tool.group === 'draw' && !layersStore.active && !onmeasured && !onregiondrawn}
    {@const irrelevant = !!onmeasured && tool.id === 'point'}
    <Tooltip content={irrelevant ? 'Points cannot be measured' : noLayer ? 'Select a layer first to start drawing' : tool.helpText} position="bottom">
      <button
        onclick={() => setTool(tool.id)}
        disabled={!drawingStore.isReady || noLayer || irrelevant}
        class="p-2.5 rounded-lg flex items-center justify-center transition-colors
               {irrelevant
                 ? 'opacity-30 cursor-not-allowed text-on-surface-variant/50'
                 : !drawingStore.isReady || noLayer
                   ? 'opacity-50 cursor-not-allowed text-on-surface-variant/50'
                   : selectionStore.activeTool === tool.id
                     ? 'bg-primary-container text-on-primary-container shadow-lg shadow-primary/20'
                     : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface'}"
        aria-label={tool.label}
        aria-pressed={selectionStore.activeTool === tool.id}
      >
        <tool.icon size={18} strokeWidth={selectionStore.activeTool === tool.id ? 2.5 : 2} />
      </button>
    </Tooltip>
  {/each}
</div>
