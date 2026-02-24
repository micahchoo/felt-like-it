<script lang="ts">
  import type { Map as MapLibreMap } from 'maplibre-gl';
  import { selectionStore } from '$lib/stores/selection.svelte.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { undoStore } from '$lib/stores/undo.svelte.js';
  import { trpc } from '$lib/utils/trpc.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import type { DrawTool } from '$lib/stores/selection.svelte.js';

  interface Props {
    map: MapLibreMap;
    onfeaturedrawn?: ((_layerId: string, _feature: Record<string, unknown>) => void) | undefined;
  }

  let { map, onfeaturedrawn }: Props = $props();

  // Lazy-load Terra Draw to avoid SSR issues
  let draw: import('terra-draw').TerraDraw | null = null;

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
    draw.on('finish', async (id: string | number) => {
      console.warn('[TerraDraw] finish event fired, id=', id, 'draw=', !!draw);
      if (!draw) return;

      const f = draw.getSnapshotFeature(id);
      console.warn('[TerraDraw] getSnapshotFeature =>', f);
      if (f) {
        await saveFeature(f as unknown as { geometry: Record<string, unknown>; properties: Record<string, unknown> });
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
      initTeraDraw().catch((err) => console.error('TerraDraw init failed:', err));
    }

    // If style is already loaded (common when navigating to the page), start immediately.
    // map.on('style.load') handles: initial load (if not ready yet) + every basemap swap.
    // Terra Draw's sources/layers are wiped on style reload, so we must re-init each time.
    if (map.isStyleLoaded()) {
      startDraw();
    }
    function onStyleLoad() {
      console.warn('[DrawingToolbar] style.load fired — re-initialising Terra Draw');
      startDraw();
    }
    map.on('style.load', onStyleLoad);

    return () => {
      map.off('style.load', onStyleLoad);
      draw?.stop();
      draw = null;
    };
  });

  async function saveFeature(f: { geometry: Record<string, unknown>; properties: Record<string, unknown> }) {
    console.warn('[TerraDraw] saveFeature geometry=', JSON.stringify(f.geometry));
    const activeLayer = layersStore.active;
    if (!activeLayer) {
      toastStore.error('No active layer. Please create or select a layer first.');
      return;
    }

    try {
      const { upsertedIds } = await trpc.features.upsert.mutate({
        layerId: activeLayer.id,
        features: [{ geometry: f.geometry, properties: f.properties }],
      });

      undoStore.push({
        description: `Draw ${String(f.geometry['type'] ?? 'feature')}`,
        undo: async () => {
          if (upsertedIds[0]) {
            await trpc.features.delete.mutate({ layerId: activeLayer.id, ids: [upsertedIds[0]] });
          }
        },
        redo: async () => {
          await trpc.features.upsert.mutate({
            layerId: activeLayer.id,
            features: [{ geometry: f.geometry, properties: f.properties }],
          });
        },
      });

      // Await the data reload so the GeoJSON source is updated BEFORE
      // removeFeatures() clears the Terra Draw overlay — no visual gap.
      await onfeaturedrawn?.(activeLayer.id, f);
    } catch {
      toastStore.error('Failed to save drawn feature.');
    }
  }

  function setTool(tool: DrawTool) {
    console.warn('[TerraDraw] setTool', tool, 'draw=', !!draw, 'draw modes=', draw?.enabled ? 'started' : 'not started');
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
        class="h-9 w-9 rounded-md flex items-center justify-center text-base transition-colors
               {selectionStore.activeTool === tool.id
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
