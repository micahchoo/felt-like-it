<script lang="ts">
  import { untrack } from 'svelte';
  import { trpc } from '$lib/utils/trpc.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import { filterStore } from '$lib/stores/filters.svelte.js';
  import { selectionStore } from '$lib/stores/selection.svelte.js';
  import { undoStore } from '$lib/stores/undo.svelte.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import MapCanvas from './MapCanvas.svelte';
  import LayerPanel from './LayerPanel.svelte';
  import BasemapPicker from './BasemapPicker.svelte';
  import type { Layer, GeoJSONFeature, LayerStyle } from '@felt-like-it/shared-types';
  import DataTable from '$lib/components/data/DataTable.svelte';
  import FilterPanel from '$lib/components/data/FilterPanel.svelte';
  import ImportDialog from '$lib/components/data/ImportDialog.svelte';
  import ExportDialog from '$lib/components/data/ExportDialog.svelte';
  import StylePanel from '$lib/components/style/StylePanel.svelte';
  import Legend from '$lib/components/style/Legend.svelte';
  import { styleStore } from '$lib/stores/style.svelte.js';
  import Button from '$lib/components/ui/Button.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import ActivityFeed from './ActivityFeed.svelte';
  import CommentPanel from './CommentPanel.svelte';
  import CollaboratorsPanel from './CollaboratorsPanel.svelte';
  import ShareDialog from './ShareDialog.svelte';
  import GeoprocessingPanel from '$lib/components/geoprocessing/GeoprocessingPanel.svelte';
  import AnnotationPanel from '$lib/components/annotations/AnnotationPanel.svelte';
  import MeasurementPanel from '$lib/components/map/MeasurementPanel.svelte';
  import type { AnnotationPinCollection, AnnotationRegionCollection } from '$lib/components/map/MapCanvas.svelte';
  import type { MeasurementResult } from '@felt-like-it/geo-engine';

  /**
   * TYPE_DEBT: features.list returns geometry as Record<string, unknown> from raw SQL;
   * the actual runtime shape is always a valid GeoJSON FeatureCollection. This guard
   * validates the structural contract so we can narrow without a double cast.
   */
  function isFeatureCollection(
    data: unknown
  ): data is { type: 'FeatureCollection'; features: GeoJSONFeature[] } {
    return (
      typeof data === 'object' &&
      data !== null &&
      (data as Record<string, unknown>)['type'] === 'FeatureCollection' &&
      Array.isArray((data as Record<string, unknown>)['features'])
    );
  }

  interface Props {
    mapId: string;
    mapTitle: string;
    initialLayers: Layer[];
    /** ID of the authenticated user — used by CommentPanel to gate delete/resolve buttons. */
    userId?: string;
    readonly?: boolean;
    /**
     * When true, renders only the map canvas and legend — no toolbar, no layer
     * panel, no basemap picker, no side panels. Implies readonly.
     * Used by the /embed/[token] route for iframe embedding.
     */
    embed?: boolean;
    /** When true, show owner-only controls (collaborator management, etc.). */
    isOwner?: boolean;
  }

  let { mapId, mapTitle, initialLayers, userId, readonly = false, embed = false, isOwner = false }: Props = $props();

  // embed implies readonly — illegal state prevented at the prop level.
  const effectiveReadonly = $derived(readonly || embed);

  // DOM element wrapping the map canvas + legend overlay — used for high-res PNG export
  let mapAreaEl = $state<HTMLDivElement | undefined>(undefined);
  $effect(() => {
    mapStore.setMapContainerEl(mapAreaEl);
    return () => { mapStore.setMapContainerEl(undefined); };
  });

  // GeoJSON data cache per layer
  let layerData = $state<Record<string, { type: 'FeatureCollection'; features: GeoJSONFeature[] }>>({});
  let showDataTable = $state(false);
  let showFilterPanel = $state(false);
  let showImportDialog = $state(false);
  let showExportDialog = $state(false);
  let showActivity = $state(false);
  let showComments = $state(false);
  let showCollaborators = $state(false);
  let showGeoprocessing = $state(false);
  let showAnnotations = $state(false);
  let showMeasure = $state(false);
  let showShareDialog = $state(false);
  let measureResult = $state<MeasurementResult | null>(null);
  let savingViewport = $state(false);

  // ── Annotation region drawing ─────────────────────────────────────────────
  // When the user wants to create a region-anchored annotation, we intercept
  // the next drawn polygon and pass its geometry to the AnnotationPanel instead
  // of saving it as a layer feature.
  let annotationRegionMode = $state(false);
  let annotationRegionGeometry = $state<{ type: 'Polygon'; coordinates: number[][][] } | undefined>(undefined);

  // ── Annotation pin GeoJSON ──────────────────────────────────────────────────
  // Annotations are stored as tRPC records but rendered via MapCanvas as a
  // dedicated GeoJSON source. Content is embedded in feature properties so the
  // popup can render without a second fetch.
  let annotationPins = $state<AnnotationPinCollection>({ type: 'FeatureCollection', features: [] });
  let annotationRegions = $state<AnnotationRegionCollection>({ type: 'FeatureCollection', features: [] });

  async function loadAnnotationPins() {
    try {
      const rows = await trpc.annotations.list.query({ mapId, rootsOnly: true });
      annotationPins = {
        type: 'FeatureCollection',
        features: rows
          .filter((a) => a.anchor.type === 'point')
          .map((a) => ({
            type: 'Feature' as const,
            id: a.id,
            geometry: a.anchor.type === 'point'
              ? { type: 'Point' as const, coordinates: a.anchor.geometry.coordinates.slice(0, 2) as [number, number] }
              : { type: 'Point' as const, coordinates: [0, 0] as [number, number] },
            properties: {
              authorName: a.authorName,
              createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
              contentJson: JSON.stringify(a.content),
              anchorType: a.anchor.type,
            },
          })),
      };
      annotationRegions = {
        type: 'FeatureCollection',
        features: rows
          .filter((a) => a.anchor.type === 'region')
          .map((a) => ({
            type: 'Feature' as const,
            id: a.id,
            geometry: a.anchor.type === 'region'
              ? a.anchor.geometry
              : { type: 'Polygon' as const, coordinates: [] },
            properties: {
              authorName: a.authorName,
              createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
              contentJson: JSON.stringify(a.content),
              anchorType: a.anchor.type,
            },
          })),
      };
    } catch {
      // Best-effort — annotation pins are non-critical; silently degrade
    }
  }

  $effect(() => { untrack(() => loadAnnotationPins()); });

  // Initialize layers — untrack the store write to prevent reading _activeLayerId
  // inside set() from becoming a tracked dependency (causes effect_update_depth_exceeded).
  $effect(() => {
    const layers = initialLayers; // tracked: re-runs if prop changes (SPA nav)
    untrack(() => {
      layersStore.set(layers);
      for (const layer of layers) {
        loadLayerData(layer.id);
      }
    });
  });

  async function loadLayerData(layerId: string) {
    try {
      const fc = await trpc.features.list.query({ layerId });
      if (!isFeatureCollection(fc)) {
        throw new Error(`Unexpected response shape from features.list for layer ${layerId}`);
      }
      layerData = { ...layerData, [layerId]: fc };

      // Push data directly to the MapLibre source to bypass svelte-maplibre-gl's
      // firstRun guard, which only sets data after the source is first registered.
      const map = mapStore.mapInstance;
      const src = map?.getSource(`source-${layerId}`);
      if (src && 'setData' in src) {
        (src as { setData: (_data: unknown) => void }).setData(fc);
      }
    } catch (err) {
      console.error('[loadLayerData] failed:', err);
      toastStore.error(`Failed to load data for layer.`);
    }
  }

  async function handleLayerChange() {
    // Reload data for the active layer
    const activeLayer = layersStore.active;
    if (activeLayer) {
      await loadLayerData(activeLayer.id);
    }
  }

  async function handleFeatureDrawn(layerId: string, _feature: Record<string, unknown>) {
    await loadLayerData(layerId);
  }

  async function saveViewport() {
    savingViewport = true;
    try {
      await trpc.maps.update.mutate({
        id: mapId,
        viewport: mapStore.getViewportSnapshot(),
        basemap: mapStore.basemapId,
      });
      toastStore.success('Viewport saved.');
      // Fire-and-forget: log activity event (best-effort, never blocks the UI)
      trpc.events.log.mutate({ mapId, action: 'viewport.saved' }).catch(() => undefined);
    } catch {
      toastStore.error('Failed to save viewport.');
    } finally {
      savingViewport = false;
    }
  }

  function handleImportComplete(layerId: string) {
    showImportDialog = false;
    layersStore.setActive(layerId);
    loadLayerData(layerId);
    // Refresh layers list, then log the activity event with the layer name
    trpc.layers.list.query({ mapId }).then((newLayers) => {
      layersStore.set(newLayers);
      const imported = newLayers.find((l) => l.id === layerId);
      trpc.events.log
        .mutate({ mapId, action: 'layer.imported', metadata: { name: imported?.name ?? '' } })
        .catch(() => undefined);
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (effectiveReadonly) return;

    // Skip when focus is inside a text input
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.target as HTMLElement)?.isContentEditable) return;

    const mod = e.metaKey || e.ctrlKey;
    if (!mod || e.key.toLowerCase() !== 'z') return;

    e.preventDefault();
    if (e.shiftKey) {
      undoStore.redo();
    } else {
      undoStore.undo();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-screen w-full overflow-hidden bg-slate-900">
  <!-- Left: Layer Panel -->
  {#if !effectiveReadonly}
    <div class="w-56 shrink-0 flex flex-col">
      <LayerPanel {mapId} onlayerchange={handleLayerChange} />
    </div>
  {/if}

  <!-- Center: Map + toolbar -->
  <div class="flex-1 relative flex flex-col min-w-0">
    <!-- Top toolbar — hidden in embed mode (bare map canvas only) -->
    {#if !embed}
    <div class="flex items-center gap-1 px-3 py-2 bg-slate-800 border-b border-white/10 shrink-0">
      <span class="text-sm font-medium text-white truncate mr-auto">{mapTitle}</span>

      {#if !effectiveReadonly}
        <Tooltip content="Import data">
          <Button variant="ghost" size="sm" onclick={() => (showImportDialog = true)}>
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M.5 9.9a.5.5 0 01.5.5v2.5a1 1 0 001 1h12a1 1 0 001-1v-2.5a.5.5 0 011 0v2.5a2 2 0 01-2 2H2a2 2 0 01-2-2v-2.5a.5.5 0 01.5-.5z"/>
              <path d="M7.646 1.146a.5.5 0 01.708 0l3 3a.5.5 0 01-.708.708L8.5 2.707V11.5a.5.5 0 01-1 0V2.707L5.354 4.854a.5.5 0 11-.708-.708l3-3z"/>
            </svg>
            Import
          </Button>
        </Tooltip>

        <Tooltip content="Export data">
          <Button variant="ghost" size="sm" onclick={() => (showExportDialog = true)}>
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M.5 9.9a.5.5 0 01.5.5v2.5a1 1 0 001 1h12a1 1 0 001-1v-2.5a.5.5 0 011 0v2.5a2 2 0 01-2 2H2a2 2 0 01-2-2v-2.5a.5.5 0 01.5-.5z"/>
              <path d="M7.646 11.854a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 10.293V1.5a.5.5 0 00-1 0v8.793L5.354 8.146a.5.5 0 10-.708.708l3 3z"/>
            </svg>
            Export
          </Button>
        </Tooltip>

        <Tooltip content="Show data table">
          <Button variant="ghost" size="sm" class={showDataTable ? 'bg-slate-700 text-white' : ''} onclick={() => (showDataTable = !showDataTable)}>
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm15 2h-4v3h4V4zm0 4h-4v3h4V8zm0 4h-4v3h3a1 1 0 001-1v-2zm-5 3v-3H6v3h4zm-5 0v-3H1v2a1 1 0 001 1h3zm-4-4h4V8H1v3zm0-4h4V4H1v3zm5-3v3h4V4H6zm4 4H6v3h4V8z"/>
            </svg>
            Table
          </Button>
        </Tooltip>

        <Tooltip content="Filter features by attribute value">
          <Button
            variant="ghost"
            size="sm"
            onclick={() => { showDataTable = true; showFilterPanel = !showFilterPanel; }}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M6 10.5a.5.5 0 01.5-.5h3a.5.5 0 010 1h-3a.5.5 0 01-.5-.5zm-2-3a.5.5 0 01.5-.5h7a.5.5 0 010 1h-7a.5.5 0 01-.5-.5zm-2-3a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5z"/>
            </svg>
            {#if layersStore.active && filterStore.hasFilters(layersStore.active.id)}
              <span class="rounded-full bg-blue-500 px-1 text-xs font-semibold leading-tight">
                {filterStore.get(layersStore.active.id).length}
              </span>
            {/if}
          </Button>
        </Tooltip>

        <Tooltip content="Save current viewport as default">
          <Button variant="ghost" size="sm" onclick={saveViewport} loading={savingViewport}>
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H9.5a1 1 0 0 0-1 1v7.293l2.646-2.647a.5.5 0 0 1 .708.708l-3.5 3.5a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L7.5 9.293V2a2 2 0 0 1 2-2H14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h2.5a.5.5 0 0 1 0 1H2z"/>
            </svg>
          </Button>
        </Tooltip>

        <div class="mx-0.5 h-5 w-px bg-white/10"></div>

        <Tooltip content={undoStore.undoLabel ? `Undo: ${undoStore.undoLabel}` : 'Undo (Ctrl+Z)'}>
          <Button variant="ghost" size="sm" onclick={() => undoStore.undo()} disabled={!undoStore.canUndo} aria-label="Undo">
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 1a6 6 0 100 12A6 6 0 008 2z"/>
              <path d="M5.354 7.354a.5.5 0 010-.708l2-2a.5.5 0 01.708.708L6.707 6.7H10a2.5 2.5 0 010 5H8.5a.5.5 0 010-1H10a1.5 1.5 0 000-3H6.707l1.355 1.346a.5.5 0 11-.708.708l-2-2z"/>
            </svg>
          </Button>
        </Tooltip>

        <Tooltip content={undoStore.redoLabel ? `Redo: ${undoStore.redoLabel}` : 'Redo (Ctrl+Shift+Z)'}>
          <Button variant="ghost" size="sm" onclick={() => undoStore.redo()} disabled={!undoStore.canRedo} aria-label="Redo">
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2z"/>
              <path d="M10.646 7.354a.5.5 0 000-.708l-2-2a.5.5 0 00-.708.708L9.293 6.7H6a2.5 2.5 0 000 5h1.5a.5.5 0 000-1H6a1.5 1.5 0 010-3h3.293L7.938 9.054a.5.5 0 10.708.708l2-2z"/>
            </svg>
          </Button>
        </Tooltip>

        <div class="mx-0.5 h-5 w-px bg-white/10"></div>

        <Tooltip content="Comment threads">
          <Button
            variant="ghost"
            size="sm"
            class={showComments ? 'bg-slate-700 text-white' : ''}
            onclick={() => (showComments = !showComments)}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M14 1a1 1 0 011 1v8a1 1 0 01-1 1H4.414A2 2 0 003 11.586l-2 2V2a1 1 0 011-1h12zm-3 3.5a.5.5 0 000-1h-6a.5.5 0 000 1h6zm0 2.5a.5.5 0 000-1h-6a.5.5 0 000 1h6zm0 2.5a.5.5 0 000-1h-3a.5.5 0 000 1h3z"/>
            </svg>
          </Button>
        </Tooltip>

        <Tooltip content="Geographic annotations (text, emoji, GIF, image, link, IIIF)">
          <Button
            variant="ghost"
            size="sm"
            class={showAnnotations ? 'bg-slate-700 text-white' : ''}
            onclick={() => (showAnnotations = !showAnnotations)}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 1a6 6 0 100 12A6 6 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3a1 1 0 011 1v2h2a1 1 0 010 2H9v2a1 1 0 01-2 0v-2H5a1 1 0 010-2h2V6a1 1 0 011-1z"/>
            </svg>
          </Button>
        </Tooltip>

        <Tooltip content="Measure distance or area">
          <Button
            variant="ghost"
            size="sm"
            class={showMeasure ? 'bg-slate-700 text-white' : ''}
            onclick={() => { showMeasure = !showMeasure; if (!showMeasure) measureResult = null; }}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M.5 14.5a.5.5 0 0 1-.354-.854l13-13a.5.5 0 0 1 .708.708l-13 13A.5.5 0 0 1 .5 14.5zM11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM8 3.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM5 .5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 5 .5zM.5 11.5a.5.5 0 0 1-.354-.854l1-1a.5.5 0 0 1 .708.708l-1 1a.5.5 0 0 1-.354.146zM3.5 8.5a.5.5 0 0 1-.354-.854l1-1a.5.5 0 0 1 .708.708l-1 1a.5.5 0 0 1-.354.146z"/>
            </svg>
          </Button>
        </Tooltip>

        <Tooltip content="Spatial geoprocessing (buffer, clip, intersect…)">
          <Button
            variant="ghost"
            size="sm"
            class={showGeoprocessing ? 'bg-slate-700 text-white' : ''}
            onclick={() => (showGeoprocessing = !showGeoprocessing)}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.5 7.5a.5.5 0 010 1H5.707l2.147 2.146a.5.5 0 01-.708.708l-3-3a.5.5 0 010-.708l3-3a.5.5 0 11.708.708L5.707 7.5H11.5z"/>
            </svg>
          </Button>
        </Tooltip>

        <Tooltip content="Manage collaborators">
          <Button
            variant="ghost"
            size="sm"
            class={showCollaborators ? 'bg-slate-700 text-white' : ''}
            onclick={() => (showCollaborators = !showCollaborators)}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M15 14s1 0 1-1-1-4-5-4-5 3-5 4 1 1 1 1h8zm-7.978-1A.261.261 0 017 12.996c.001-.264.167-1.03.76-1.72C8.312 10.629 9.282 10 11 10c1.717 0 2.687.63 3.24 1.276.593.69.758 1.457.76 1.72l-.008.002-.014.002H7.022zM11 7a2 2 0 100-4 2 2 0 000 4zm3-2a3 3 0 11-6 0 3 3 0 016 0zM6.936 9.28a5.88 5.88 0 00-1.23-.247A7.35 7.35 0 005 9c-4 0-5 3-5 4 0 .667.333 1 1 1h4.216A2.238 2.238 0 015 13c0-1.01.377-2.042 1.09-2.904.243-.294.526-.569.846-.816zM4.92 10A5.493 5.493 0 004 13H1c0-.26.164-1.03.76-1.724.545-.636 1.492-1.256 3.16-1.275zM1.5 5.5a3 3 0 116 0 3 3 0 01-6 0zm3-2a2 2 0 100 4 2 2 0 000-4z"/>
            </svg>
          </Button>
        </Tooltip>

        <Tooltip content="Share map">
          <Button
            variant="ghost"
            size="sm"
            onclick={() => (showShareDialog = true)}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M13.5 1a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM11 2.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zm-5.5 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM3 7a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zm9 4.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm-2.5 1.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0z"/>
              <path d="M7.5 6.35l4-2.3.5.87-4 2.3-.5-.87zm0 4.3l4 2.3.5-.87-4-2.3-.5.87z"/>
            </svg>
          </Button>
        </Tooltip>

        <Tooltip content="Map activity log">
          <Button
            variant="ghost"
            size="sm"
            class={showActivity ? 'bg-slate-700 text-white' : ''}
            onclick={() => (showActivity = !showActivity)}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm14.5 5.5h-13v1h13v-1zM2 4.5h12v1H2v-1zm0 4h8v1H2v-1z"/>
            </svg>
          </Button>
        </Tooltip>
      {/if}
    </div>
    {/if}

    <!-- Map area — bind:this synced to mapStore.mapContainerEl for high-res export -->
    <div class="relative flex-1 min-h-0" bind:this={mapAreaEl}>
      <MapCanvas
        readonly={effectiveReadonly}
        {layerData}
        onfeaturedrawn={handleFeatureDrawn}
        {annotationPins}
        {annotationRegions}
        {...(showMeasure ? { onmeasured: (r: MeasurementResult) => { measureResult = r; } } : {})}
        {...(annotationRegionMode ? { onregiondrawn: (g: { type: 'Polygon'; coordinates: number[][][] }) => { annotationRegionGeometry = g; annotationRegionMode = false; } } : {})}
      />

      <!-- Measurement panel overlay -->
      {#if showMeasure && !effectiveReadonly}
        <MeasurementPanel
          result={measureResult}
          onclear={() => { showMeasure = false; measureResult = null; }}
        />
      {/if}

      <!-- Map overlay controls — hidden in embed mode for a truly bare canvas -->
      {#if !embed}
      <div class="absolute bottom-6 left-3 flex gap-2">
        <BasemapPicker />
      </div>
      {/if}

      <Legend />
    </div>

    <!-- Data table + filter panel (collapsible bottom panel) -->
    {#if showDataTable && layersStore.active}
      {@const activeLayer = layersStore.active}
      {@const rawFeatures = layerData[activeLayer.id]?.features ?? []}
      {@const filteredFeatures = filterStore.applyToFeatures(activeLayer.id, rawFeatures)}
      <div class="border-t border-white/10 shrink-0 flex flex-col overflow-hidden" style="height: {showFilterPanel ? '22rem' : '16rem'}">
        {#if showFilterPanel}
          <FilterPanel layerId={activeLayer.id} features={rawFeatures} />
        {/if}
        <div class="flex-1 min-h-0 overflow-hidden">
          <DataTable
            features={filteredFeatures}
            style={activeLayer.style as LayerStyle}
          />
        </div>
      </div>
    {/if}
  </div>

  <!-- Right: Style Panel (when editing) -->
  <!-- Rendered via styleStore.editingLayerId; layerFeatures powers the choropleth attribute picker -->
  <StylePanel
    layerFeatures={styleStore.editingLayerId
      ? (layerData[styleStore.editingLayerId]?.features ?? [])
      : []}
  />

  <!-- Comment panel (collapsible, right side) -->
  {#if showComments && !effectiveReadonly}
    <div class="w-72 shrink-0 overflow-hidden flex flex-col">
      <CommentPanel {mapId} readonly={effectiveReadonly} {...(userId !== undefined ? { userId } : {})} />
    </div>
  {/if}

  <!-- Collaborators panel (collapsible, right side) -->
  {#if showCollaborators && !effectiveReadonly}
    <div class="w-72 shrink-0 overflow-hidden flex flex-col">
      <CollaboratorsPanel {mapId} {isOwner} />
    </div>
  {/if}

  <!-- Annotation panel (collapsible, right side) -->
  {#if showAnnotations && !effectiveReadonly}
    <div class="w-72 shrink-0 overflow-hidden flex flex-col">
      <AnnotationPanel
        {mapId}
        {...(userId !== undefined ? { userId } : {})}
        onannotationchange={() => { annotationRegionGeometry = undefined; loadAnnotationPins(); }}
        onrequestregion={() => { annotationRegionMode = true; annotationRegionGeometry = undefined; selectionStore.setActiveTool('polygon'); }}
        regionGeometry={annotationRegionGeometry}
      />
    </div>
  {/if}

  <!-- Geoprocessing panel (collapsible, right side) -->
  {#if showGeoprocessing && !effectiveReadonly}
    <div class="w-72 shrink-0 overflow-hidden flex flex-col">
      <GeoprocessingPanel
        {mapId}
        layers={layersStore.all}
        onlayercreated={async (layerId) => {
          // Refresh layer list first so the GeoJSONSource is rendered before
          // loadLayerData attempts map.getSource(). Order matters here.
          const newLayers = await trpc.layers.list.query({ mapId });
          layersStore.set(newLayers);
          await loadLayerData(layerId);
        }}
      />
    </div>
  {/if}

  <!-- Activity feed panel (collapsible, right-most) -->
  {#if showActivity && !effectiveReadonly}
    <div class="w-56 shrink-0 overflow-hidden flex flex-col">
      <ActivityFeed {mapId} />
    </div>
  {/if}
</div>

<!-- Dialogs -->
{#if showImportDialog}
  <ImportDialog
    {mapId}
    bind:open={showImportDialog}
    onimported={handleImportComplete}
  />
{/if}

{#if showExportDialog}
  <ExportDialog
    layers={layersStore.all}
    bind:open={showExportDialog}
  />
{/if}

<ShareDialog
  {mapId}
  bind:open={showShareDialog}
  onclose={() => (showShareDialog = false)}
/>
