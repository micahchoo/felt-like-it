<script lang="ts">
  import type { Map as MapLibreMap } from 'maplibre-gl';
  import { selectionStore } from '$lib/stores/selection.svelte.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { undoStore } from '$lib/stores/undo.svelte.js';
  import { trpc } from '$lib/utils/trpc.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import type { DrawTool } from '$lib/stores/selection.svelte.js';
  import { measureLine, measurePolygon } from '@felt-like-it/geo-engine';
  import type { MeasurementResult } from '@felt-like-it/geo-engine';
  import type { GeoJSONStoreFeatures } from 'terra-draw';

  interface Props {
    map: MapLibreMap;
    onfeaturedrawn?: ((_layerId: string, _feature: Record<string, unknown>) => void) | undefined;
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

  // Lazy-load Terra Draw to avoid SSR issues
  let draw: import('terra-draw').TerraDraw | null = null;
  let drawReady = $state(false);

  async function initTeraDraw() {
    const { TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode, TerraDrawPolygonMode, TerraDrawSelectMode } = await import('terra-draw');
    const { TerraDrawMapLibreGLAdapter } = await import('terra-draw-maplibre-gl-adapter');

    draw = new TerraDraw({
      // terra-draw-maplibre-gl-adapter ≥1.3 no longer needs a `lib` param
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPointMode(),
        new TerraDrawLineStringMode(),
        new TerraDrawPolygonMode({ snapping: { toLine: true, toCoordinate: true } }),
        new TerraDrawSelectMode(),
      ],
    });

    draw.start();

    // terra-draw ≥1.x: finish fires with a single FeatureId (string | number),
    // not an array. Use getSnapshotFeature(id) for direct lookup.
    drawReady = true;

    draw.on('finish', async (id: string | number) => {
      if (!draw) return;

      const f = draw.getSnapshotFeature(id);

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
      if (!draw) return;

      // Always remove the drawn feature from Terra Draw's overlay.
      // Saved features are re-rendered via the GeoJSON source; unsaved
      // orphans must be cleared or they corrupt subsequent draw operations.
      try {
        draw.removeFeatures([id]);
      } catch (e) {
        console.warn('[TerraDraw] removeFeatures failed:', e);
      }

      // Reset to select mode after drawing
      draw.setMode('select');
      selectionStore.setActiveTool('select');
    });
  }

  $effect(() => {
    if (!map) return;

    function startDraw() {
      draw?.stop();
      draw = null;
      drawReady = false;
      initTeraDraw().catch((err) => {
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

    return () => {
      map.off('style.load', onStyleLoad);
      draw?.stop();
      draw = null;
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
      const { upsertedIds } = await trpc.features.upsert.mutate({
        layerId: activeLayer.id,
        features: [{ geometry, properties }],
      });

      undoStore.push({
        description: `Draw ${f.geometry.type}`,
        undo: async () => {
          if (upsertedIds[0]) {
            await trpc.features.delete.mutate({ layerId: activeLayer.id, ids: [upsertedIds[0]] });
          }
        },
        redo: async () => {
          await trpc.features.upsert.mutate({
            layerId: activeLayer.id,
            features: [{ geometry, properties }],
          });
        },
      });

      // Await the data reload so the GeoJSON source is updated BEFORE
      // removeFeatures() clears the Terra Draw overlay — no visual gap.
      await onfeaturedrawn?.(activeLayer.id, { geometry, properties });
    } catch {
      toastStore.error('Failed to save drawn feature.');
    }
  }

  // Sync external activeTool changes (e.g. annotation region request) to Terra Draw
  $effect(() => {
    const tool = selectionStore.activeTool;
    if (!draw || !drawReady) return;
    const modeMap: Record<string, string> = { point: 'point', line: 'linestring', polygon: 'polygon', select: 'select' };
    const mode = tool ? modeMap[tool] ?? 'select' : 'select';
    try { draw.setMode(mode); } catch { /* mode already active */ }
  });

  function setTool(tool: DrawTool) {
    selectionStore.setActiveTool(tool);
    if (!draw) return;

    switch (tool) {
      case 'point': draw.setMode('point'); break;
      case 'line': draw.setMode('linestring'); break;
      case 'polygon': draw.setMode('polygon'); break;
      case 'select': draw.setMode('select'); break;
      default: draw.setMode('select'); break;
    }
  }

  const tools: Array<{ id: DrawTool; label: string; icon: string }> = [
    { id: 'select', label: 'Select', icon: '↖' },
    { id: 'point', label: 'Draw Point', icon: '●' },
    { id: 'line', label: 'Draw Line', icon: '╱' },
    { id: 'polygon', label: 'Draw Polygon', icon: '⬠' },
  ];
</script>

<div
  class="absolute left-3 top-1/2 -translate-y-1/2 flex flex-col gap-1 bg-slate-800/90 backdrop-blur-sm rounded-lg p-1 shadow-xl ring-1 ring-white/10"
  role="toolbar"
  aria-label="Drawing tools"
>
  {#each tools as tool (tool.id)}
    <Tooltip content={tool.label} position="right">
      <button
        onclick={() => setTool(tool.id)}
        disabled={!drawReady}
        class="h-9 w-9 rounded-md flex items-center justify-center text-base transition-colors
               {!drawReady
                 ? 'opacity-50 cursor-not-allowed text-slate-500'
                 : selectionStore.activeTool === tool.id
                   ? 'bg-blue-600 text-white'
                   : 'text-slate-300 hover:bg-slate-700 hover:text-white'}"
        aria-label={tool.label}
        aria-pressed={selectionStore.activeTool === tool.id}
      >
        {tool.icon}
      </button>
    </Tooltip>
  {/each}
</div>
