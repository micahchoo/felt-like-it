<script lang="ts">
  import { untrack } from 'svelte';
  import type { Map as MapLibreMap } from 'maplibre-gl';
  import { effectEnter, effectExit } from '$lib/debug/effect-tracker.js';
  import { getMapEditorState, type DrawTool } from '$lib/stores/map-editor-state.svelte.js';
  import { getLayersStore } from '$lib/stores/layers.svelte.js';
  const layersStore = getLayersStore();
  import { getUndoStore } from '$lib/stores/undo.svelte.js';
  const undoStore = getUndoStore();
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import { MousePointer2, Circle, Spline, Pentagon } from 'lucide-svelte';
  import { measureLine, measurePolygon } from '@felt-like-it/geo-engine';
  import type { DistanceMeasurement, AreaMeasurement } from '@felt-like-it/geo-engine';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { GeoJSONStoreFeatures } from 'terra-draw';
  import {
    createAnnotationMutationOptions,
    deleteAnnotationMutationOptions,
  } from '$lib/components/annotations/AnnotationMutations.js';
  import type { Anchor } from '@felt-like-it/shared-types';

  // TYPE_DEBT: terra-draw's GeoJSONStoreFeatures treats `id` as an optional property
  // and `properties` as an opaque record. Shape SnapshotFeature structurally compatible
  // under exactOptionalPropertyTypes; non-null-assert `.id!` is safe at call sites because
  // terra-draw assigns an id on every finish event (validated at runtime).
  type SnapshotFeature = {
    id?: string | number | undefined;
    properties: Record<string, unknown>;
  };

  interface Props {
    map: MapLibreMap;
    /**
     * Fires after a TerraDraw commit creates an annotation row. Carries the
     * persisted id + anchor type. Used by the parent for cross-cutting
     * concerns (activity logging; future panel-scroll/focus). Narrow on
     * purpose — the panel + cache invalidation own re-render.
     */
    onannotationdrawn?: ((_annotation: { id: string; anchorType: Anchor['type'] }) => void) | undefined;
    /**
     * When provided, the drawing toolbar enters measurement mode: drawn features
     * are NOT saved to any layer — instead, the computed measurement is passed
     * to this callback.  The caller is responsible for displaying the result.
     */
    onmeasured?: ((_result: DistanceMeasurement | AreaMeasurement) => void) | undefined;
    /**
     * When provided, the next drawn polygon is captured as an annotation region
     * instead of being saved to a layer. The callback receives the polygon geometry.
     * Automatically clears after one polygon is captured.
     */
    onregiondrawn?: ((_geometry: { type: 'Polygon'; coordinates: number[][][] }) => void) | undefined;
  }

  let { map, onannotationdrawn, onmeasured, onregiondrawn }: Props = $props();

  const editorState = getMapEditorState();
  const queryClient = useQueryClient();

  // mapId is read off layersStore.active at options-build time; the factory pattern in
  // svelte-query re-evaluates options reactively, so a layer change picks up the new mapId.
  const createAnnotationMutation = createMutation(() => {
    const mapId = layersStore.active?.mapId ?? '';
    return createAnnotationMutationOptions({ queryClient, mapId });
  });
  const deleteAnnotationMutation = createMutation(() => {
    const mapId = layersStore.active?.mapId ?? '';
    return deleteAnnotationMutationOptions({ queryClient, mapId });
  });

  $effect(() => {
    effectEnter('DT:initTerraDraw', { hasMap: !!map });
    if (!map) { effectExit('DT:initTerraDraw'); return; }

    function startDraw() {
      // untrack: reset()/init() read _state internally (for guards) but this
      // effect should only track the `map` prop — not editorState reactive state.
      // Without untrack, reset()'s `if (_state.status === 'ready')` check creates
      // a tracked dependency on _state, and each new { status: 'idle' } object
      // re-triggers this effect → infinite loop with syncToolToTerraDraw.
      untrack(() => editorState.reset());
      editorState.initDrawing(map).then((draw) => {
        if (!draw) return;

        draw.on('finish', async (id: string | number) => {
          if (!editorState.drawingInstance) return;

          const f = editorState.drawingInstance.getSnapshotFeature(id);

          if (f) {
            if (onregiondrawn && f.geometry.type === 'Polygon') {
              // Annotation region mode — pass geometry to parent; do NOT persist to DB
              onregiondrawn(f.geometry as { type: 'Polygon'; coordinates: number[][][] });
            } else if (onmeasured) {
              // Measurement mode — compute result and notify parent; do NOT persist to DB
              measureFeature(f);
            } else {
              await saveAsAnnotation(f);
            }
          }

          // Re-check: component may have unmounted during the async save
          if (!editorState.drawingInstance) return;

          // Always remove the drawn feature from Terra Draw's overlay.
          // Saved features are re-rendered via the GeoJSON source; unsaved
          // orphans must be cleared or they corrupt subsequent draw operations.
          try {
            editorState.drawingInstance.removeFeatures([id]);
          } catch (e) {
            console.warn('[TerraDraw] removeFeatures failed:', e);
          }

          // Reset to select mode after drawing
          editorState.drawingInstance.setMode('select');
          editorState.setActiveTool('select');
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
      untrack(() => editorState.stopDrawing());
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

  /**
   * TerraDraw commit handler. Persists drawn shapes as `annotation_objects`
   * rows (Phase 3 unified-annotations model). Imports + computed layers
   * still write to `features`; user-drawn shapes do not.
   *
   * Optimism: owned by createAnnotationMutationOptions.onMutate (cancelQueries
   * + setQueryData), so AnnotationRenderer re-renders the new shape before
   * TerraDraw clears its overlay.
   *
   * Parent notification: narrow `onannotationdrawn(id, anchorType)` callback —
   * the panel re-render is owned by cache invalidation, the parent only
   * receives signal for cross-cutting concerns (activity log).
   */
  function deriveAnchor(geometry: GeoJSONStoreFeatures['geometry']): Anchor | null {
    // Anchor is a discriminated union over { type, geometry }. Terra Draw GeoJSON
    // shapes are structurally compatible with the matching geometry schemas
    // (Point/LineString/Polygon) — the cast below crosses the typing-only gap
    // between terra-draw's GeoJSONStoreFeatures and shared-types geometry schemas.
    if (geometry.type === 'Point') {
      return { type: 'point', geometry: geometry as Extract<Anchor, { type: 'point' }>['geometry'] };
    }
    if (geometry.type === 'LineString') {
      return { type: 'path', geometry: geometry as Extract<Anchor, { type: 'path' }>['geometry'] };
    }
    if (geometry.type === 'Polygon') {
      return { type: 'region', geometry: geometry as Extract<Anchor, { type: 'region' }>['geometry'] };
    }
    return null;
  }

  async function saveAsAnnotation(f: GeoJSONStoreFeatures) {
    const activeLayer = layersStore.active;
    if (!activeLayer) {
      toastStore.error('No active layer. Please create or select a layer first.');
      return;
    }

    const anchor = deriveAnchor(f.geometry);
    if (!anchor) {
      // TerraDraw config should not surface tools that emit MultiPoint / GeometryCollection,
      // but defend the boundary anyway — schema validation server-side would reject.
      console.warn('[DrawingToolbar] saveAsAnnotation: unsupported geometry type', f.geometry.type);
      toastStore.error('Unsupported shape type for annotation.');
      return;
    }

    const properties = (f.properties ?? {}) as Record<string, unknown>;
    const propertyName = typeof properties['name'] === 'string' ? (properties['name'] as string) : undefined;
    const mapId = activeLayer.mapId;

    try {
      const created = await createAnnotationMutation.mutateAsync({
        mapId,
        anchor,
        // Empty body is intentional — the user labels the annotation post-create
        // via the panel's name/description fields. Keeping body.text empty avoids
        // surfacing TerraDraw's auto-properties (e.g. 'mode') as user-visible text.
        content: { kind: 'single', body: { type: 'text', text: '' } },
        ...(propertyName !== undefined ? { name: propertyName } : {}),
        // Phase 3 Wave D-α — annotations created via the toolbar inherit the
        // active layer so DataTable can filter the per-layer view.
        layerId: activeLayer.id,
      });

      // Capture the live row identity so undo/redo target the current server state
      // even after a redo recreates the annotation with a fresh id/version.
      const handle = { id: created.id, version: created.version };
      undoStore.push({
        description: `Draw ${f.geometry.type}`,
        undo: async () => {
          await deleteAnnotationMutation.mutateAsync({ id: handle.id, version: handle.version });
        },
        redo: async () => {
          const recreated = await createAnnotationMutation.mutateAsync({
            mapId,
            anchor,
            content: { kind: 'single', body: { type: 'text', text: '' } },
            ...(propertyName !== undefined ? { name: propertyName } : {}),
          });
          handle.id = recreated.id;
          handle.version = recreated.version;
        },
      });

      // Wave A.4 — narrow annotation-aware callback for cross-cutting concerns
      // (activity logging today; future panel-scroll / focus-management). Carries
      // only what the parent needs to act on (id + anchor type), not the full
      // row. The annotation-renderer / panel re-render is owned by tanstack
      // query cache invalidation in createAnnotationMutationOptions.onSuccess —
      // no parent involvement needed for that.
      onannotationdrawn?.({ id: created.id, anchorType: anchor.type });
    } catch (err) {
      // createAnnotationMutationOptions.onError already rolled back the cache + toasted.
      console.error('[DrawingToolbar] saveAsAnnotation failed:', err);
    }
  }

  // Sync external activeTool changes (e.g. annotation region request) to Terra Draw
  $effect(() => {
    const tool = editorState.activeTool;
    effectEnter('DT:syncToolToTerraDraw', { tool, isReady: editorState.isDrawingReady });
    if (!editorState.drawingInstance || !editorState.isDrawingReady) { effectExit('DT:syncToolToTerraDraw'); return; }
    const modeMap: Record<string, string> = { point: 'point', line: 'linestring', polygon: 'polygon', select: 'select' };
    const mode = tool ? modeMap[tool] ?? 'select' : 'select';
    if (editorState.drawingInstance.getMode() !== mode) {
      // Before switching modes, check for in-progress (unsaved) geometry
      const snapshot = editorState.drawingInstance.getSnapshot() ?? [];
      // TYPE_DEBT: terra-draw GeoJSONStoreFeatures properties are typed as Record<string,unknown>
      const inProgress = snapshot.filter((f: SnapshotFeature) => f.properties?.mode !== 'static');
      if (inProgress.length > 0) {
        // Schedule confirm outside reactive cycle to avoid blocking $effect
        const instance = editorState.drawingInstance;
        setTimeout(() => {
          const confirmed = window.confirm('You have an unfinished drawing. Discard it?');
          if (!confirmed) return;
          try {
            instance.removeFeatures(inProgress.map((f: SnapshotFeature) => f.id!));
          } catch (e) {
            console.warn('[DrawingToolbar] removeFeatures during tool switch failed:', e);
          }
          try {
            instance.setMode(mode);
          } catch (e) {
            console.warn('[DrawingToolbar] setMode failed:', e);
          }
        }, 0);
        effectExit('DT:syncToolToTerraDraw');
        return;
      }
      try {
        editorState.drawingInstance.setMode(mode);
      } catch (e) {
        console.warn('[DrawingToolbar] setMode failed:', e);
      }
    }
    effectExit('DT:syncToolToTerraDraw');
  });

  // Cancel in-progress drawing on Escape key. Bound via <svelte:document> below
  // (declarative — runtime cleanup, no manual removeEventListener boilerplate).
  // Guarded internally by isDrawingReady since Svelte's directive can't be
  // conditionally mounted as ergonomically.
  function handleEscapeCancel(e: KeyboardEvent) {
    if (!editorState.isDrawingReady) return;
    if (e.key !== 'Escape') return;
    const snapshot = editorState.drawingInstance?.getSnapshot();
    if (snapshot) {
      // TYPE_DEBT: terra-draw GeoJSONStoreFeatures properties are typed as Record<string,unknown>
      const inProgress = snapshot.filter((f: SnapshotFeature) => f.properties?.mode !== 'static');
      if (inProgress.length > 0) {
        try {
          editorState.drawingInstance?.removeFeatures(inProgress.map((f: SnapshotFeature) => f.id!));
        } catch (err) {
          console.warn('[DrawingToolbar] removeFeatures on Escape failed:', err);
        }
      }
    }
    editorState.setActiveTool('select');
  }

  /** Check whether Terra Draw is mid-draw (incomplete geometry in progress). */
  function isDrawing(): boolean {
    return editorState.drawingInstance?.getModeState() === 'drawing';
  }

  /** Cancel the current in-progress drawing and return to select mode. */
  function cancelDrawing() {
    if (!editorState.drawingInstance) return;
    // Switching to select mode discards any incomplete geometry
    editorState.drawingInstance.setMode('select');
    editorState.setActiveTool('select');
  }

  // Task 2.3: Escape key cancels in-progress drawing
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && isDrawing()) {
      e.preventDefault();
      cancelDrawing();
    }
  }

  function setTool(tool: DrawTool) {
    if (isDrawing()) {
      const discard = window.confirm('You have an unfinished drawing. Discard it?');
      if (!discard) return;
      // Clean up in-progress features now so the $effect sync won't prompt again
      if (editorState.drawingInstance) {
        const snapshot = editorState.drawingInstance.getSnapshot() ?? [];
        const inProgress = snapshot.filter((f: SnapshotFeature) => f.properties?.mode !== 'static');
        if (inProgress.length > 0) {
          try {
            editorState.drawingInstance.removeFeatures(inProgress.map((f: SnapshotFeature) => f.id!));
          } catch (e) {
            console.warn('[DrawingToolbar] removeFeatures during tool switch failed:', e);
          }
        }
      }
    }

    // The $effect (DT:syncToolToTerraDraw) handles the actual Terra Draw mode switch.
    // Calling setMode() here too creates a dual-write race where both paths fire
    // and Terra Draw's select mode exit throws on stale internal state.
    editorState.setActiveTool(tool);
  }

  const tools: Array<{ id: DrawTool; label: string; helpText: string; icon: typeof MousePointer2; group: 'select' | 'draw' }> = [
    { id: 'select', label: 'Select', helpText: 'Click a feature to view details or annotate it', icon: MousePointer2, group: 'select' },
    { id: 'point', label: 'Point', helpText: 'Click to place a point marker on the map', icon: Circle, group: 'draw' },
    { id: 'line', label: 'Line', helpText: 'Click to add vertices, double-click to finish the line', icon: Spline, group: 'draw' },
    { id: 'polygon', label: 'Polygon', helpText: 'Click to add vertices, double-click to close the shape', icon: Pentagon, group: 'draw' },
  ];
</script>

<svelte:window onkeydown={handleKeydown} />
<svelte:document onkeydown={handleEscapeCancel} />

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
        disabled={!editorState.isDrawingReady || noLayer || irrelevant}
        class="p-2.5 rounded-lg flex items-center justify-center transition-colors
               {irrelevant
                 ? 'opacity-30 cursor-not-allowed text-on-surface-variant/50'
                 : !editorState.isDrawingReady || noLayer
                   ? 'opacity-50 cursor-not-allowed text-on-surface-variant/50'
                   : editorState.activeTool === tool.id
                     ? 'bg-primary-container text-on-primary-container shadow-lg shadow-primary/20'
                     : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface'}"
        aria-label="{tool.label}: {tool.helpText}"
        aria-pressed={editorState.activeTool === tool.id}
      >
        <tool.icon size={18} strokeWidth={editorState.activeTool === tool.id ? 2.5 : 2} />
      </button>
    </Tooltip>
  {/each}
</div>
