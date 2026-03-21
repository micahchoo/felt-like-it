<script lang="ts">
  import { untrack } from 'svelte';
  import { effectEnter, effectExit, mutation } from '$lib/debug/effect-tracker.js';
  import { trpc } from '$lib/utils/trpc.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import { filterStore, loadFilters, saveFilters } from '$lib/stores/filters.svelte.js';
  import { selectionStore } from '$lib/stores/selection.svelte.js';
  import { undoStore } from '$lib/stores/undo.svelte.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import MapCanvas from './MapCanvas.svelte';
  import LayerPanel from './LayerPanel.svelte';
  import BasemapPicker from './BasemapPicker.svelte';
  import type { Layer, GeoJSONFeature, LayerStyle } from '@felt-like-it/shared-types';
import { resolveFeatureId } from '$lib/utils/resolve-feature-id.js';
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
  import ShareDialog from './ShareDialog.svelte';
  import GeoprocessingPanel from '$lib/components/geoprocessing/GeoprocessingPanel.svelte';
  import AnnotationPanel from '$lib/components/annotations/AnnotationPanel.svelte';
  import SidePanel from './SidePanel.svelte';
  import type { SectionId } from './SidePanel.svelte';
  import { createAnnotationGeoStore } from '$lib/stores/annotation-geo.svelte.js';
  import { createViewportStore } from '$lib/stores/viewport.svelte.js';
  import type { MeasurementResult } from '@felt-like-it/geo-engine';
  import { measureLine, measurePolygon } from '@felt-like-it/geo-engine';
  import MeasurementPanel from './MeasurementPanel.svelte';
  import DrawActionRow from './DrawActionRow.svelte';
  import type { Geometry } from 'geojson';
  import { PUBLIC_MARTIN_URL } from '$env/static/public';
  import { VECTOR_TILE_THRESHOLD } from '$lib/utils/constants.js';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { queryKeys } from '$lib/utils/query-keys.js';
  import { hotOverlay } from '$lib/utils/map-sources.svelte.js';
  import { type InteractionState, type SelectedFeature, type PickedFeatureRef, interactionModes } from '$lib/stores/interaction-modes.svelte.js';

  function isLargeLayer(layer: Layer): boolean {
    return PUBLIC_MARTIN_URL.length > 0 && (layer.featureCount ?? 0) > VECTOR_TILE_THRESHOLD;
  }

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
    /** ID of the authenticated user — used by AnnotationPanel to gate delete/resolve buttons. */
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
    /** Role of the current user — shown as a badge for non-owners to clarify permissions. */
    userRole?: string;
  }

  let { mapId, mapTitle, initialLayers, userId, readonly = false, embed = false, isOwner = false, userRole }: Props = $props();

  const mapQueryClient = useQueryClient();

  // ── Annotation pins query (shared cache with AnnotationPanel) ─────────────
  const annotationPinsQuery = createQuery(() => ({
    queryKey: queryKeys.annotations.list({ mapId }),
    queryFn: () => trpc.annotations.list.query({ mapId }),
    enabled: !!userId, // Skip for unauthenticated guests (share/embed pages)
  }));

  // embed implies readonly — illegal state prevented at the prop level.
  const effectiveReadonly = $derived(readonly || embed);

  // DOM element wrapping the map canvas + legend overlay — used for high-res PNG export
  let mapAreaEl = $state<HTMLDivElement | undefined>(undefined);
  $effect(() => {
    effectEnter('ME:mapContainerEl', { hasEl: !!mapAreaEl });
    mapStore.setMapContainerEl(mapAreaEl);
    effectExit('ME:mapContainerEl');
    return () => { mapStore.setMapContainerEl(undefined); };
  });

  // ── Filter persistence ────────────────────────────────────────────────────
  // Load persisted filters once when the editor mounts (runs once: mapId is stable).
  $effect(() => {
    loadFilters(mapId);
  });

  // Save filters to localStorage whenever filter state changes for any layer.
  $effect(() => {
    // Access every layer's filters to create a reactive dependency on the full state.
    for (const layer of layersStore.all) {
      filterStore.get(layer.id);
    }
    saveFilters(mapId);
  });

  // ── Viewport persistence ──────────────────────────────────────────────────
  // Save viewport to localStorage on moveend so the user returns to the same
  // position after navigating away and back. Fires for all maps regardless of
  // layer type (the large-layer moveend handler is separate and conditional).
  $effect(() => {
    const map = mapStore.mapInstance;
    if (!map) return;

    function persistViewport() {
      mapStore.saveViewportLocally(mapId);
    }

    map.on('moveend', persistViewport);
    return () => {
      map.off('moveend', persistViewport);
    };
  });

  // GeoJSON data cache per layer
  let layerData = $state<Record<string, { type: 'FeatureCollection'; features: GeoJSONFeature[] }>>({});
  let showDataTable = $state(false);
  let activePanelIcon = $state<'layers' | 'processing' | 'tables' | 'export' | null>('layers');
  let cursorLat = $state<number | null>(null);
  let cursorLng = $state<number | null>(null);
  let currentZoom = $state(0);
  let showFilterPanel = $state(false);
  let showImportDialog = $state(false);
  let showExportDialog = $state(false);
  let showShareDialog = $state(false);
  let measureResult = $state<MeasurementResult | null>(null);
  let savingViewport = $state(false);

  // ── Viewport-based pagination state for large layers ─────────────────────
  const viewportStore = createViewportStore({
    fetchFn: (params) => trpc.features.listPaged.query(params),
    getActiveLayer: () => layersStore.active,
    isLargeLayer: isLargeLayer as (layer: { id: string }) => boolean,
    getMap: () => mapStore.mapInstance ?? undefined,
    onError: (err) => {
      console.error('[fetchViewportFeatures] failed:', err);
      toastStore.error('Failed to load features for viewport');
    },
  });

  // ── Design mode + unified sidebar ──────────────────────────────────────────
  let designMode = $state(false);
  let activeSection = $state<SectionId | null>('annotations');
  let analysisTab = $state<'measure' | 'process'>('process');

  // Count tracking for sidebar badges
  let annotationCount = $state(0);
  let commentCount = $state(0);
  let eventCount = $state(0);
  let activityRefreshTrigger = $state(0);

  const measureActive = $derived(activeSection === 'analysis' && analysisTab === 'measure' && !designMode);

  $effect(() => {
    effectEnter('ME:measureActive', { measureActive });
    if (!measureActive) measureResult = null;
    effectExit('ME:measureActive');
  });

  // ── Interaction state (discriminated union) ───────────────────────────────
  // Types and transitionTo() live in $lib/stores/interaction-modes.svelte.ts.
  // This component binds a local accessor for brevity; the store owns the state.
  const { transitionTo } = interactionModes;
  const interactionState = $derived(interactionModes.state);

  let scrollToAnnotationFeatureId = $state<string | null>(null);

  // Clean up stale modes when sidebar section changes
  $effect(() => {
    const section = activeSection; // track
    effectEnter('ME:sectionCleanup', { section });
    if (section !== 'annotations') {
      const currentType = untrack(() => interactionState.type);
      if (
        currentType === 'drawRegion' ||
        currentType === 'pickFeature' ||
        currentType === 'pendingMeasurement'
      ) {
        transitionTo({ type: 'idle' });
      }
    }
    effectExit('ME:sectionCleanup');
  });

  // Clean up when design mode toggles
  $effect(() => {
    effectEnter('ME:designModeCleanup', { designMode });
    if (designMode) {
      transitionTo({ type: 'idle' });
      selectionStore.clearSelection();
      selectionStore.setActiveTool('select');
    }
    effectExit('ME:designModeCleanup');
  });

  // Track selection → featureSelected
  $effect(() => {
    const feat = selectionStore.selectedFeature;
    const lid = selectionStore.selectedLayerId;
    effectEnter('ME:selectionToFeature', { featId: feat?.id, lid });
    if (feat && lid) {
      const geom = feat.geometry as Geometry | undefined;
      const fid = resolveFeatureId(feat as any);
      const currentType = untrack(() => interactionState.type);
      if (geom && fid && (currentType === 'idle' || currentType === 'featureSelected')) {
        transitionTo({ type: 'featureSelected', feature: { featureId: fid, layerId: lid, geometry: geom } });
      }
    } else {
      const currentType = untrack(() => interactionState.type);
      if (currentType === 'featureSelected') {
        transitionTo({ type: 'idle' });
      }
    }
    effectExit('ME:selectionToFeature');
  });

  // Dismiss featureSelected on drawing tool switch
  $effect(() => {
    const tool = selectionStore.activeTool;
    effectEnter('ME:toolDismissFeature', { tool });
    if (tool && tool !== 'select') {
      const currentType = untrack(() => interactionState.type);
      if (currentType === 'featureSelected') {
        transitionTo({ type: 'idle' });
      }
      if (currentType === 'drawRegion' && tool !== 'polygon') {
        transitionTo({ type: 'idle' });
      }
    }
    effectExit('ME:toolDismissFeature');
  });

  // Feature pick capture
  $effect(() => {
    const feat = selectionStore.selectedFeature;
    const lid = selectionStore.selectedLayerId;
    effectEnter('ME:featurePickCapture', { featId: feat?.id, lid });
    if (feat && lid) {
      const current = untrack(() => interactionState);
      if (current.type === 'pickFeature' && !current.picked) {
        const fid = resolveFeatureId(feat as any);
        if (fid) {
          transitionTo({
            type: 'pickFeature',
            picked: { featureId: fid, layerId: lid },
          });
        }
      }
    }
    effectExit('ME:featurePickCapture');
  });

  // ── Annotation pin GeoJSON (derived from query cache) ──────────────────────
  // Annotations are stored as tRPC records but rendered via MapCanvas as a
  // dedicated GeoJSON source. Content is embedded in feature properties so the
  // popup can render without a second fetch.
  // These derived values auto-update when any annotation mutation invalidates
  // the shared query cache — no manual refresh needed.
  const annotationGeo = createAnnotationGeoStore(() => annotationPinsQuery.data ?? []);

  // Initialize layers
  $effect(() => {
    const layers = initialLayers;
    effectEnter('ME:initLayers', { count: layers.length });
    untrack(() => {
      layersStore.set(layers);
      for (const layer of layers) {
        if (!isLargeLayer(layer)) {
          loadLayerData(layer.id);
        }
      }
    });
    effectExit('ME:initLayers');
  });

  // Viewport-based loading for large layers
  $effect(() => {
    const map = mapStore.mapInstance;
    const activeLayer = layersStore.active;
    effectEnter('ME:viewportLoading', { hasMap: !!map, activeLayer: activeLayer?.id });
    if (!map || !activeLayer || !isLargeLayer(activeLayer)) { effectExit('ME:viewportLoading'); return; }

    return viewportStore.bindMap(map);
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
    const activeLayer = layersStore.active;
    if (!activeLayer) return;
    if (isLargeLayer(activeLayer)) return; // vector tiles handle rendering
    if (!layerData[activeLayer.id]) {
      await loadLayerData(activeLayer.id);
    }
  }

  function logActivity(action: string, metadata?: Record<string, unknown>) {
    trpc.events.log.mutate({ mapId, action, metadata }).catch(() => undefined);
    activityRefreshTrigger++;
  }

  async function handleFeatureDrawn(layerId: string, _feature: Record<string, unknown> & { id?: string | undefined }) {
    const drawnLayer = layersStore.all.find((l) => l.id === layerId);
    if (!drawnLayer || !isLargeLayer(drawnLayer)) {
      // Invalidate the features query so the GeoJSON source refreshes with
      // server data. For large layers, DrawingToolbar already added the feature
      // to hotOverlay for immediate rendering via vector tiles + hot overlay.
      mapQueryClient.invalidateQueries({ queryKey: queryKeys.features.list({ layerId }) });
      await loadLayerData(layerId);
    }

    const geom = _feature['geometry'] as Geometry | undefined;
    const fid = _feature['id'] ?? '';
    if (geom && fid) {
      transitionTo({ type: 'featureSelected', feature: { featureId: String(fid), layerId, geometry: geom } });
    }

    logActivity('feature.drawn', {
      layerId,
      layerName: drawnLayer?.name ?? '',
      geometryType: geom?.type ?? '',
    });
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
    // Re-fetch layers to get updated featureCount, then load data if not large
    trpc.layers.list.query({ mapId }).then((newLayers) => {
      layersStore.set(newLayers);
      const imported = newLayers.find((l) => l.id === layerId);
      if (imported && !isLargeLayer(imported)) {
        loadLayerData(layerId);
      }
      trpc.events.log
        .mutate({ mapId, action: 'layer.imported', metadata: { name: imported?.name ?? '' } })
        .catch(() => undefined);
    });
  }

  function handleKeydown(e: KeyboardEvent) {
    if (effectiveReadonly) return;

    if (e.key === 'Escape') {
      if (interactionState.type === 'drawRegion' || interactionState.type === 'pickFeature') {
        transitionTo({ type: 'idle' });
        return;
      }
    }

    // Skip when focus is inside a text input
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if ((e.target as HTMLElement)?.isContentEditable) return;

    // Ctrl+\ — toggle design mode
    if ((e.metaKey || e.ctrlKey) && e.key === '\\') {
      e.preventDefault();
      designMode = !designMode;
      return;
    }

    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        undoStore.redo();
      } else {
        undoStore.undo();
      }
      return;
    }

    // 1/2/3 — switch drawing tools (only in editing mode, no modifier keys, not in text inputs)
    const tag2 = (e.target as HTMLElement)?.tagName;
    if (!designMode && !mod && !e.shiftKey && !e.altKey && tag2 !== 'INPUT' && tag2 !== 'TEXTAREA' && !(e.target as HTMLElement)?.isContentEditable) {
      switch (e.key) {
        case '1': selectionStore.setActiveTool('select'); break;
        case '2': selectionStore.setActiveTool('point'); break;
        case '3': selectionStore.setActiveTool('polygon'); break;
      }
    }
  }

  // Clear hot overlay features on component unmount
  $effect(() => {
    effectEnter('ME:hotOverlayCleanup');
    effectExit('ME:hotOverlayCleanup');
    return () => {
      hotOverlay.clearHotFeatures();
    };
  });

  // ── Status bar: cursor position + zoom level ───────────────────────────────
  $effect(() => {
    const map = mapStore.mapInstance;
    if (!map) return;

    const onMouseMove = (e: { lngLat: { lat: number; lng: number } }) => {
      cursorLat = e.lngLat.lat;
      cursorLng = e.lngLat.lng;
    };
    const onZoom = () => {
      currentZoom = map.getZoom();
    };

    currentZoom = map.getZoom();
    map.on('mousemove', onMouseMove);
    map.on('zoom', onZoom);

    return () => {
      map.off('mousemove', onMouseMove);
      map.off('zoom', onZoom);
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-screen w-full overflow-hidden bg-surface">
  <!-- Left: Icon rail + LayerPanel flyout -->
  {#if !effectiveReadonly && !designMode}
    <!-- Icon rail -->
    <div class="w-[52px] shrink-0 flex flex-col items-center pt-2 gap-1 bg-surface-container border-r border-surface-high">
      <button
        class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg transition-colors w-full {activePanelIcon === 'layers' ? 'bg-surface-high text-primary' : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface'}"
        onclick={() => { activePanelIcon = activePanelIcon === 'layers' ? null : 'layers'; }}
        title="Layers"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
        <span class="text-[8px] font-display uppercase tracking-wider">Layers</span>
      </button>
      <button
        class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg transition-colors w-full {activePanelIcon === 'processing' ? 'bg-surface-high text-primary' : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface'}"
        onclick={() => { activePanelIcon = activePanelIcon === 'processing' ? null : 'processing'; activeSection = 'analysis'; }}
        title="Processing"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
        <span class="text-[8px] font-display uppercase tracking-wider">Process</span>
      </button>
      <button
        class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg transition-colors w-full {showDataTable ? 'bg-surface-high text-primary' : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface'}"
        onclick={() => { showDataTable = !showDataTable; }}
        title="Tables"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
        <span class="text-[8px] font-display uppercase tracking-wider">Tables</span>
      </button>
      <button
        class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg transition-colors w-full text-on-surface-variant hover:bg-surface-high hover:text-on-surface"
        onclick={() => { showExportDialog = true; }}
        title="Export"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg>
        <span class="text-[8px] font-display uppercase tracking-wider">Export</span>
      </button>
    </div>
    <!-- LayerPanel flyout -->
    {#if activePanelIcon === 'layers'}
      <div class="w-56 shrink-0 flex flex-col bg-surface-container border-r border-surface-high">
        <LayerPanel {mapId} onlayerchange={handleLayerChange} />
      </div>
    {/if}
  {/if}

  <!-- Center: Map + toolbar -->
  <div class="flex-1 relative flex flex-col min-w-0">
    <!-- Top toolbar — hidden in embed mode (bare map canvas only) -->
    {#if !embed}
    <div class="flex items-center gap-1 px-3 py-2 bg-surface-container border-b border-surface-high shrink-0">
      <span class="text-sm font-medium font-display text-on-surface truncate mr-auto">{mapTitle}</span>
      {#if userRole && userRole !== 'owner'}
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-high/80 text-on-surface-variant capitalize">
          {userRole}
        </span>
      {/if}

      {#if !effectiveReadonly}
        <!-- Design mode toggle -->
        <Tooltip content={designMode ? 'Exit style editor — back to map editing (Ctrl+\\)' : 'Style editor — customize colors, sizes, and layer appearance (Ctrl+\\)'}>
          <Button
            variant={designMode ? 'primary' : 'ghost'}
            size="sm"
            onclick={() => { designMode = !designMode; }}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M12.854.146a.5.5 0 00-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 000-.708l-3-3zM13.5 6.207L9.793 2.5 3.622 8.671a.5.5 0 00-.121.196l-1.458 4.374a.5.5 0 00.632.632l4.374-1.458a.5.5 0 00.196-.121L13.5 6.207z"/>
            </svg>
            Style
          </Button>
        </Tooltip>

        {#if !designMode}
          <Tooltip content="Import — add data from files (GeoJSON, CSV, Shapefile, KML, GPX, GeoPackage)">
            <Button variant="ghost" size="sm" onclick={() => (showImportDialog = true)}>
              <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M.5 9.9a.5.5 0 01.5.5v2.5a1 1 0 001 1h12a1 1 0 001-1v-2.5a.5.5 0 011 0v2.5a2 2 0 01-2 2H2a2 2 0 01-2-2v-2.5a.5.5 0 01.5-.5z"/>
                <path d="M7.646 1.146a.5.5 0 01.708 0l3 3a.5.5 0 01-.708.708L8.5 2.707V11.5a.5.5 0 01-1 0V2.707L5.354 4.854a.5.5 0 11-.708-.708l3-3z"/>
              </svg>
              Import
            </Button>
          </Tooltip>

          <Tooltip content="Export — download layer data as GeoJSON, CSV, or other formats">
            <Button variant="ghost" size="sm" onclick={() => (showExportDialog = true)}>
              <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M.5 9.9a.5.5 0 01.5.5v2.5a1 1 0 001 1h12a1 1 0 001-1v-2.5a.5.5 0 011 0v2.5a2 2 0 01-2 2H2a2 2 0 01-2-2v-2.5a.5.5 0 01.5-.5z"/>
                <path d="M7.646 11.854a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 10.293V1.5a.5.5 0 00-1 0v8.793L5.354 8.146a.5.5 0 10-.708.708l3 3z"/>
              </svg>
              Export
            </Button>
          </Tooltip>

          <Tooltip content="Data table — view and browse all features in the active layer as rows">
            <Button variant="ghost" size="sm" class={showDataTable ? 'bg-surface-high text-on-surface' : ''} onclick={() => (showDataTable = !showDataTable)}>
              <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm15 2h-4v3h4V4zm0 4h-4v3h4V8zm0 4h-4v3h3a1 1 0 001-1v-2zm-5 3v-3H6v3h4zm-5 0v-3H1v2a1 1 0 001 1h3zm-4-4h4V8H1v3zm0-4h4V4H1v3zm5-3v3h4V4H6zm4 4H6v3h4V8z"/>
              </svg>
              Table
            </Button>
          </Tooltip>

          <Tooltip content="Filter — show only features matching specific attribute values (e.g. 'type = park')">
            <Button
              variant="ghost"
              size="sm"
              onclick={() => { showDataTable = true; showFilterPanel = !showFilterPanel; }}
            >
              <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M6 10.5a.5.5 0 01.5-.5h3a.5.5 0 010 1h-3a.5.5 0 01-.5-.5zm-2-3a.5.5 0 01.5-.5h7a.5.5 0 010 1h-7a.5.5 0 01-.5-.5zm-2-3a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5z"/>
              </svg>
              Filter
              {#if layersStore.active && filterStore.hasFilters(layersStore.active.id)}
                <span class="rounded-full bg-blue-500 px-1 text-xs font-semibold leading-tight">
                  {filterStore.get(layersStore.active.id).length}
                </span>
              {/if}
            </Button>
          </Tooltip>

          <Tooltip content="Lock viewport — saves current position and zoom as the default view whenever anyone opens this map">
            <Button variant="ghost" size="sm" onclick={saveViewport} loading={savingViewport}>
              <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 1a2 2 0 0 0-2 2v4H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H7V3a1 1 0 0 1 2 0v1a.5.5 0 0 0 1 0V3a2 2 0 0 0-2-2z"/>
              </svg>
              Lock View
            </Button>
          </Tooltip>

          <div class="mx-0.5 h-5 w-px bg-surface-high"></div>

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

          <div class="flex-1"></div>

          <Tooltip content="Share — invite collaborators, create embed links, or manage access">
            <Button
              variant="ghost"
              size="sm"
              onclick={() => (showShareDialog = true)}
            >
              <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M13.5 1a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM11 2.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zm-5.5 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM3 7a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zm9 4.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm-2.5 1.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0z"/>
                <path d="M7.5 6.35l4-2.3.5.87-4 2.3-.5-.87zm0 4.3l4 2.3.5-.87-4-2.3-.5.87z"/>
              </svg>
              Share
            </Button>
          </Tooltip>
        {/if}
      {/if}
    </div>
    {/if}

    <!-- Map area — bind:this synced to mapStore.mapContainerEl for high-res export -->
    <div class="relative flex-1 min-h-0" bind:this={mapAreaEl}>
      <MapCanvas
        readonly={effectiveReadonly}
        {layerData}
        onfeaturedrawn={handleFeatureDrawn}
        annotationPins={annotationGeo.pins}
        annotationRegions={annotationGeo.regions}
        {...(measureActive ? { onmeasured: (r: MeasurementResult) => { measureResult = r; } } : {})}
        {...(interactionState.type === 'drawRegion' && !interactionState.geometry ? { onregiondrawn: (g: { type: 'Polygon'; coordinates: number[][][] }) => { transitionTo({ type: 'drawRegion', geometry: g }); } } : {})}
        annotatedFeatures={annotationGeo.index}
        measurementAnnotations={annotationGeo.measurements}
        onbadgeclick={(featureId) => {
          activeSection = 'annotations';
          scrollToAnnotationFeatureId = featureId;
        }}
      />

      {#if interactionState.type === 'drawRegion' && !interactionState.geometry}
        <div class="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-blue-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
          Draw a polygon to define the annotation region ·
          <button class="underline ml-1" onclick={() => { transitionTo({ type: 'idle' }); }}>Cancel (Esc)</button>
        </div>
      {:else if interactionState.type === 'pickFeature' && !interactionState.picked}
        <div class="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-amber-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg">
          Click a feature to attach annotation ·
          <button class="underline ml-1" onclick={() => { transitionTo({ type: 'idle' }); }}>Cancel (Esc)</button>
        </div>
      {/if}

      {#if interactionState.type === 'featureSelected' && !measureActive}
        <div class="absolute bottom-16 left-1/2 -translate-x-1/2 z-40">
          <DrawActionRow
            onannotate={() => {
              if (interactionState.type === 'featureSelected') {
                const { feature } = interactionState;
                transitionTo({
                  type: 'pickFeature',
                  picked: { featureId: feature.featureId, layerId: feature.layerId },
                });
                activeSection = 'annotations';
              }
            }}
            onmeasure={() => {
              if (interactionState.type !== 'featureSelected') return;
              const { geometry } = interactionState.feature;
              transitionTo({ type: 'idle' });
              if (geometry.type === 'LineString') {
                measureResult = measureLine(geometry.coordinates as [number, number][]);
              } else if (geometry.type === 'Polygon') {
                measureResult = measurePolygon(geometry.coordinates as [number, number][][]);
              }
              activeSection = 'analysis';
              analysisTab = 'measure';
            }}
            ondismiss={() => { transitionTo({ type: 'idle' }); }}
          />
        </div>
      {/if}

      <!-- Map overlay controls — hidden in embed mode for a truly bare canvas -->
      {#if !embed}
      <div class="absolute bottom-6 left-3 flex gap-2">
        <BasemapPicker />
      </div>
      {/if}

      <Legend />
    </div>

    <!-- Status bar -->
    <div class="flex items-center gap-4 px-3 py-1 bg-surface-lowest text-[10px] font-display uppercase tracking-wider text-on-surface-variant shrink-0 border-t border-surface-high">
      {#if cursorLat !== null && cursorLng !== null}
        <span>LAT {cursorLat.toFixed(4)}</span>
        <span>LNG {cursorLng.toFixed(4)}</span>
      {:else}
        <span>LAT —</span>
        <span>LNG —</span>
      {/if}
      <span class="text-on-surface-variant/50">|</span>
      <span>CRS EPSG:4326</span>
      <span>ZOOM {currentZoom.toFixed(1)}</span>
      <span class="ml-auto flex items-center gap-1.5">
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 status-glow"></span>
        CONNECTED
      </span>
    </div>

    <!-- Data table + filter panel (collapsible bottom panel) -->
    {#if showDataTable && layersStore.active}
      {@const activeLayer = layersStore.active}
      {@const rawFeatures = layerData[activeLayer.id]?.features ?? []}
      {@const filteredFeatures = filterStore.applyToFeatures(activeLayer.id, rawFeatures)}
      <div class="border-t border-surface-high shrink-0 flex flex-col overflow-hidden" style="height: {showFilterPanel && !isLargeLayer(activeLayer) ? '22rem' : '16rem'}">
        {#if isLargeLayer(activeLayer)}
          <div class="px-3 py-1.5 bg-blue-900/30 border-b border-blue-500/20 text-xs text-blue-300 flex items-center gap-2 shrink-0">
            <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Large layer ({(activeLayer.featureCount ?? 0).toLocaleString()} features) — rendered via vector tiles. {viewportStore.loading ? 'Loading…' : 'Use the table to inspect features in the current viewport.'}</span>
          </div>
        {:else if showFilterPanel}
          <FilterPanel layerId={activeLayer.id} features={rawFeatures} />
        {/if}
        <div class="flex-1 min-h-0 overflow-hidden">
          {#if isLargeLayer(activeLayer)}
            <DataTable
              mode="server"
              serverRows={viewportStore.rows}
              serverTotal={viewportStore.total}
              serverPage={viewportStore.page}
              serverPageSize={viewportStore.pageSize}
              onPageChange={(p) => viewportStore.changePage(p)}
              onPageSizeChange={(s) => viewportStore.changePageSize(s)}
              onSortChange={(by, dir) => viewportStore.changeSortBy(by, dir)}
            />
          {:else}
            <DataTable
              features={filteredFeatures}
              style={activeLayer.style as LayerStyle}
            />
          {/if}
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

  <!-- Snippet definitions for SidePanel content -->
  {#snippet annotationsContent()}
    <AnnotationPanel
      {mapId}
      embedded
      {...(userId !== undefined ? { userId } : {})}
      onannotationsaved={(action) => {
        if (action === 'created') {
          if (interactionState.type === 'drawRegion' || interactionState.type === 'pickFeature') {
            transitionTo({ type: 'idle' });
          }
        }
        if (action) {
          logActivity(`annotation.${action}`);
        }
      }}
      onrequestregion={() => { transitionTo({ type: 'drawRegion' }); }}
      onrequestfeaturepick={() => { transitionTo({ type: 'pickFeature' }); }}
      regionGeometry={interactionState.type === 'drawRegion' ? interactionState.geometry : undefined}
      pickedFeature={interactionState.type === 'pickFeature' ? interactionState.picked : undefined}
      pendingMeasurement={interactionState.type === 'pendingMeasurement' ? { anchor: interactionState.anchor, content: interactionState.content } : null}
      scrollToFeatureId={scrollToAnnotationFeatureId}
      oncountchange={(a, c) => { annotationCount = a; commentCount = c; }}
    />
  {/snippet}

  {#snippet analysisContent()}
    <div class="flex flex-col h-full">
      <!-- Sub-tab switcher -->
      <div class="flex border-b border-surface-high shrink-0">
        <button
          class="flex-1 py-2 text-xs font-display uppercase tracking-wide font-medium text-center transition-colors
                 {analysisTab === 'measure'
                   ? 'text-blue-400 border-b-2 border-blue-400'
                   : 'text-on-surface-variant hover:text-on-surface'}"
          onclick={() => { analysisTab = 'measure'; }}
        >
          Measure
        </button>
        <button
          class="flex-1 py-2 text-xs font-display uppercase tracking-wide font-medium text-center transition-colors
                 {analysisTab === 'process'
                   ? 'text-blue-400 border-b-2 border-blue-400'
                   : 'text-on-surface-variant hover:text-on-surface'}"
          onclick={() => { analysisTab = 'process'; }}
        >
          Process
        </button>
      </div>

      {#if analysisTab === 'measure'}
        <MeasurementPanel
          {measureResult}
          onclear={() => { measureResult = null; }}
          onsaveasannotation={(payload) => {
            transitionTo(payload);
            activeSection = 'annotations';
          }}
        />
      {:else}
        <GeoprocessingPanel
          {mapId}
          embedded
          layers={layersStore.all}
          onlayercreated={async (layerId) => {
            const newLayers = await trpc.layers.list.query({ mapId });
            layersStore.set(newLayers);
            await loadLayerData(layerId);
            const newLayer = newLayers.find((l: { id: string }) => l.id === layerId);
            logActivity('geoprocessing.completed', {
              outputLayerId: layerId,
              outputLayerName: newLayer?.name ?? '',
            });
          }}
        />
      {/if}
    </div>
  {/snippet}

  {#snippet activityContent()}
    <ActivityFeed {mapId} embedded refreshTrigger={activityRefreshTrigger} oncountchange={(n) => { eventCount = n; }} />
  {/snippet}

  <!-- Right: Side panel (hidden in design mode and embed) -->
  {#if !designMode && !embed}
    <SidePanel
      sections={[
        { id: 'annotations', label: 'Annotations', icon: 'M8 1a6 6 0 100 12A6 6 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3a1 1 0 011 1v2h2a1 1 0 010 2H9v2a1 1 0 01-2 0v-2H5a1 1 0 010-2h2V6a1 1 0 011-1z', count: annotationCount + commentCount, helpText: 'Add notes, comments, and observations to specific places on the map. Pin annotations to points, draw regions, or attach them to existing features.', content: annotationsContent },
        { id: 'analysis', label: 'Analysis', icon: 'M.5 14.5a.5.5 0 0 1-.354-.854l13-13a.5.5 0 0 1 .708.708l-13 13A.5.5 0 0 1 .5 14.5zM11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM8 3.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM5 .5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 5 .5z', helpText: 'Measure distances and areas by drawing on the map, or run spatial operations like buffer and intersect to create new layers from existing data.', content: analysisContent },
        { id: 'activity', label: 'Activity', icon: 'M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm14.5 5.5h-13v1h13v-1zM2 4.5h12v1H2v-1zm0 4h8v1H2v-1z', count: eventCount, helpText: 'A timeline of all changes to this map — imports, edits, annotations, and viewport saves. Useful for tracking who did what and when.', content: activityContent },
      ]}
      {activeSection}
      onchange={(s) => { activeSection = s; }}
    />
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
  {isOwner}
  {...(userId !== undefined ? { userId } : {})}
/>
