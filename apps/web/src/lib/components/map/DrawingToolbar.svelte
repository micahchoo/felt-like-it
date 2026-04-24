<script lang="ts">
  import { untrack } from 'svelte';
  import type { Map as MapLibreMap } from 'maplibre-gl';
  import { effectEnter, effectExit } from '$lib/debug/effect-tracker.js';
  import { getMapEditorState, type DrawTool } from '$lib/stores/map-editor-state.svelte.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { undoStore } from '$lib/stores/undo.svelte.js';
  import { trpc } from '$lib/utils/trpc.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import { MousePointer2, Circle, Spline, Pentagon } from 'lucide-svelte';
  import { measureLine, measurePolygon } from '@felt-like-it/geo-engine';
  import type { DistanceMeasurement, AreaMeasurement } from '@felt-like-it/geo-engine';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { queryKeys } from '$lib/utils/query-keys.js';
  import { hotOverlay } from '$lib/utils/map-sources.svelte.js';
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
    onfeaturedrawn?: ((_layerId: string, _feature: Record<string, unknown> & { id?: string | undefined }) => void) | undefined;
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

  let { map, onfeaturedrawn, onmeasured, onregiondrawn }: Props = $props();

  const editorState = getMapEditorState();
  const queryClient = useQueryClient();

  type FeatureUpsertInput = {
    layerId: string;
    features: { geometry: Record<string, unknown>; properties: Record<string, unknown> }[];
  };
  type FeatureDeleteInput = { layerId: string; ids: string[] };

  const featureUpsertMutation = createMutation<
    { upsertedIds: string[] },
    Error,
    FeatureUpsertInput,
    unknown
  >(() => ({
    mutationFn: (input) =>
      trpc.features.upsert.mutate(input) as Promise<{ upsertedIds: string[] }>,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.features.list({ layerId: variables.layerId }) });
    },
    onError: (_err, variables) => {
      hotOverlay.clearHotFeatures(variables.layerId);
      toastStore.error('Failed to save feature. Please try again.');
    },
  }));

  const featureDeleteMutation = createMutation<unknown, Error, FeatureDeleteInput, unknown>(() => ({
    mutationFn: (input) => trpc.features.delete.mutate(input) as Promise<unknown>,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.features.list({ layerId: variables.layerId }) });
    },
    onError: () => {
      // The feature was NOT deleted — it still exists in the DB.
      // No hotOverlay cleanup needed; notify the user so they can retry.
      toastStore.error('Failed to delete feature. Please try again.');
    },
  }));

  // Phase 3 Wave A.1 (2026-04-25) — parallel annotation-create path.
  // Reachable only via saveAsAnnotation(); dispatch flip happens in Wave A.2.
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
              // Wave A.2 (2026-04-25) — TerraDraw commits flow to annotation_objects.
              // saveFeature() is unreachable from this dispatch; kept until Wave B
              // for revertability and so its tests + helper still type-check.
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

  // Wave A.2 (2026-04-25) — saveFeature + featureUpsertMutation +
  // featureDeleteMutation are unreachable from the dispatch above (which now
  // routes to saveAsAnnotation). They are kept compiled until Wave B
  // (features table application-write lock-down) so the dispatch flip stays
  // independently revertable. The void-references at the bottom of this
  // function keep svelte-check 6133 quiet without disabling the rule.
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

    // Optimistic UI: add to hotOverlay immediately so the feature stays visible
    // while the server round-trip completes (Terra Draw removes it from its own
    // overlay when it fires 'finish'). We use a temp ID that gets replaced with
    // the real server-assigned ID once the mutation succeeds.
    const tempId = `temp-${Date.now()}`;
    hotOverlay.addHotFeature(activeLayer.id, {
      type: 'Feature',
      id: tempId,
      geometry: geometry as unknown as GeoJSON.Geometry,
      properties: properties as GeoJSON.GeoJsonProperties,
    });

    try {
      const { upsertedIds } = await featureUpsertMutation.mutateAsync({
        layerId: activeLayer.id,
        features: [{ geometry, properties }],
      });

      // Replace temp entry with the real server-assigned ID
      hotOverlay.removeHotFeature(activeLayer.id, tempId);
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
            await featureDeleteMutation.mutateAsync({ layerId: activeLayer.id, ids: [upsertedIds[0]] });
            hotOverlay.removeHotFeature(activeLayer.id, upsertedIds[0]);
          }
        },
        redo: async () => {
          const result = await featureUpsertMutation.mutateAsync({
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
      // Roll back the optimistic hotOverlay entry — save failed, nothing on server
      hotOverlay.removeHotFeature(activeLayer.id, tempId);
      console.error('[DrawingToolbar] saveFeature failed:', err);
      toastStore.error('Failed to save drawn feature.');
    }
  }

  /**
   * Phase 3 Wave A.1 — parallel annotation-create path. NOT yet wired into
   * draw.on('finish'); reachable only when Wave A.2 flips the dispatch.
   *
   * Differs from saveFeature in three ways:
   *  1. Persists to `annotation_objects` (mapId-scoped) instead of `features`
   *     (layer-scoped). The active layer is still required as a UX gate, but
   *     the annotation row itself does not carry layerId.
   *  2. Optimism is owned by the tanstack query cache (createAnnotationMutationOptions
   *     already does cancelQueries + setQueryData + rollback on error). No hotOverlay.
   *  3. No parent callback yet — Wave A.4 introduces `onannotationdrawn` to replace
   *     `onfeaturedrawn`'s post-draw selection + activity-log responsibilities. Until
   *     then, annotation cache invalidation handles parent re-render of the panel.
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

      // Wave A.2 bridge — keep the old onfeaturedrawn callback firing until
      // Wave A.4 introduces onannotationdrawn. Reasons (per plan risk note):
      //   1. The await synchronizes parent re-render with TerraDraw's
      //      removeFeatures() call, preventing a visual-flash race.
      //   2. activityStore.log + (eventually) the post-draw selection
      //      transition still need an entrypoint until A.4 rewires them.
      // Known A.2 regression: parent's transitionTo({featureSelected, ...})
      // will pass an annotation id where it expects a feature id; the highlight
      // simply won't match. Fixed in A.4 by replacing the callback with
      // onannotationdrawn that carries {id, anchor} for an annotation-aware
      // selection transition.
      const geometry = f.geometry as unknown as Record<string, unknown>;
      await onfeaturedrawn?.(activeLayer.id, { geometry, properties, id: created.id });
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

  // Cancel in-progress drawing on Escape key
  $effect(() => {
    if (!editorState.isDrawingReady) return;
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        const snapshot = editorState.drawingInstance?.getSnapshot();
        if (snapshot) {
          // TYPE_DEBT: terra-draw GeoJSONStoreFeatures properties are typed as Record<string,unknown>
          const inProgress = snapshot.filter((f: SnapshotFeature) => f.properties?.mode !== 'static');
          if (inProgress.length > 0) {
            try {
              editorState.drawingInstance?.removeFeatures(inProgress.map((f: SnapshotFeature) => f.id!));
            } catch (e) {
              console.warn('[DrawingToolbar] removeFeatures on Escape failed:', e);
            }
          }
        }
        editorState.setActiveTool('select');
      }
    }
    document.addEventListener('keydown', handleKeydown);
    return () => document.removeEventListener('keydown', handleKeydown);
  });

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

  // Wave A.2 (2026-04-25) — saveFeature is dead code pending Wave B removal.
  // Reference it explicitly so svelte-check 6133 doesn't churn until then.
  void saveFeature;
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
