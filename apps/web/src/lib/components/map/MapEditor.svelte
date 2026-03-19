<script lang="ts">
  import { untrack } from 'svelte';
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
  import type { AnnotationPinCollection, AnnotationRegionCollection } from '$lib/components/map/MapCanvas.svelte';
  import type { MeasurementResult, DistanceUnit, AreaUnit } from '@felt-like-it/geo-engine';
  import { DISTANCE_UNITS, AREA_UNITS, formatDistance, formatArea, measureLine, measurePolygon } from '@felt-like-it/geo-engine';
  import DrawActionRow from './DrawActionRow.svelte';
  import type { Geometry } from 'geojson';
  import { PUBLIC_MARTIN_URL } from '$env/static/public';
  import { VECTOR_TILE_THRESHOLD } from '$lib/utils/constants.js';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { queryKeys } from '$lib/utils/query-keys.js';
  import { hotOverlay } from '$lib/utils/map-sources.svelte.js';

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
    mapStore.setMapContainerEl(mapAreaEl);
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
    for (const layer of layersStore.layers) {
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
  let showFilterPanel = $state(false);
  let showImportDialog = $state(false);
  let showExportDialog = $state(false);
  let showShareDialog = $state(false);
  let measureResult = $state<MeasurementResult | null>(null);
  let savingViewport = $state(false);

  // ── Viewport-based pagination state for large layers ─────────────────────
  let viewportAbort: AbortController | null = null;
  let viewportRows = $state<Array<{ id: string; properties: Record<string, unknown>; geometryType: string }>>([]);
  let viewportTotal = $state(0);
  let viewportPage = $state(1);
  let viewportPageSize = $state(50);
  let viewportSortBy = $state<'created_at' | 'updated_at' | 'id'>('created_at');
  let viewportSortDir = $state<'asc' | 'desc'>('asc');
  let viewportLoading = $state(false);

  async function fetchViewportFeatures() {
    const activeLayer = layersStore.active;
    if (!activeLayer || !isLargeLayer(activeLayer)) return;

    const map = mapStore.mapInstance;
    if (!map) return;

    const bounds = map.getBounds();
    const bbox: [number, number, number, number] = [
      bounds.getWest(),
      bounds.getSouth(),
      bounds.getEast(),
      bounds.getNorth(),
    ];

    viewportAbort?.abort();
    const controller = new AbortController();
    viewportAbort = controller;

    viewportLoading = true;
    try {
      const result = await trpc.features.listPaged.query({
        layerId: activeLayer.id,
        bbox,
        limit: viewportPageSize,
        offset: (viewportPage - 1) * viewportPageSize,
        sortBy: viewportSortBy,
        sortDir: viewportSortDir,
      });
      if (!controller.signal.aborted) {
        viewportRows = result.rows;
        viewportTotal = result.total;
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      console.error('[fetchViewportFeatures] failed:', err);
      toastStore.error('Failed to load features for viewport');
    } finally {
      viewportLoading = false;
    }
  }

  let moveEndTimer: ReturnType<typeof setTimeout> | undefined;

  function handleMoveEnd() {
    clearTimeout(moveEndTimer);
    moveEndTimer = setTimeout(() => {
      viewportPage = 1;
      fetchViewportFeatures();
    }, 300);
  }

  function handleViewportPageChange(page: number) {
    viewportPage = page;
    fetchViewportFeatures();
  }

  function handleViewportPageSizeChange(size: number) {
    viewportPageSize = size;
    viewportPage = 1;
    fetchViewportFeatures();
  }

  function handleViewportSortChange(sortBy: string, sortDir: 'asc' | 'desc') {
    viewportSortBy = sortBy as 'created_at' | 'updated_at' | 'id';
    viewportSortDir = sortDir;
    viewportPage = 1;
    fetchViewportFeatures();
  }

  // ── Design mode + unified sidebar ──────────────────────────────────────────
  let designMode = $state(false);
  let activeSection = $state<SectionId | null>('annotations');
  let analysisTab = $state<'measure' | 'process'>('process');

  // Measurement state (moved from MeasurementPanel)
  let distUnit = $state<DistanceUnit>('km');
  let areaUnit = $state<AreaUnit>('km2');
  let periUnit = $state<DistanceUnit>('km');

  // Count tracking for sidebar badges
  let annotationCount = $state(0);
  let commentCount = $state(0);
  let eventCount = $state(0);
  let activityRefreshTrigger = $state(0);

  const measureActive = $derived(activeSection === 'analysis' && analysisTab === 'measure' && !designMode);

  $effect(() => {
    if (!measureActive) measureResult = null;
  });

  // ── Interaction state (discriminated union) ───────────────────────────────
  // Replaces: annotationRegionMode, annotationRegionGeometry, featurePickMode,
  // pickedFeature, activeFeature, pendingMeasurementAnnotation.
  // Compiler enforces mutual exclusivity — no invalid flag combinations.
  type SelectedFeature = {
    featureId: string;
    layerId: string;
    geometry: Geometry;
  };

  type PickedFeatureRef = {
    featureId: string;
    layerId: string;
  };

  type InteractionState =
    | { type: 'idle' }
    | { type: 'featureSelected'; feature: SelectedFeature }
    | { type: 'drawRegion'; geometry?: { type: 'Polygon'; coordinates: number[][][] } }
    | { type: 'pickFeature'; picked?: PickedFeatureRef }
    | { type: 'pendingMeasurement'; anchor: {
        type: 'measurement';
        geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'Polygon'; coordinates: [number, number][][] };
      }; content: {
        type: 'measurement';
        measurementType: 'distance' | 'area';
        value: number;
        unit: string;
        displayValue: string;
      } };

  let interactionState: InteractionState = $state({ type: 'idle' });

  /** Centralized mode transition — atomically sets interactionState and implied tool.
   *  Uses untrack() for the prev-state read so it's safe to call from $effect blocks. */
  function transitionTo(next: InteractionState) {
    const prev = untrack(() => interactionState);
    interactionState = next;

    // Entry actions: set the tool implied by the target mode
    switch (next.type) {
      case 'drawRegion':
        selectionStore.setActiveTool('polygon');
        break;
      case 'pickFeature':
        selectionStore.setActiveTool('select');
        break;
      case 'idle':
        // Reset tool when leaving annotation-capture modes
        if (prev.type === 'drawRegion' || prev.type === 'pickFeature' || prev.type === 'pendingMeasurement') {
          selectionStore.setActiveTool('select');
        }
        break;
    }
  }

  let scrollToAnnotationFeatureId = $state<string | null>(null);

  // Clean up stale modes when sidebar section changes —
  // if the user was in region-draw or feature-pick mode and navigates away,
  // those modes must not persist and intercept future draws.
  // Uses untrack() to avoid circular dependency (reads + writes interactionState).
  $effect(() => {
    const section = activeSection; // track
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
  });

  // Clean up when design mode toggles — all interaction modes are irrelevant in style editor
  $effect(() => {
    if (designMode) {
      transitionTo({ type: 'idle' });
      selectionStore.setActiveTool('select'); // unconditional reset for design mode
    }
  });

  // Track selection → featureSelected
  // Only from idle or featureSelected — don't clobber other modes.
  // Uses untrack() for interactionState reads to avoid circular dependency
  // (this effect writes interactionState, so reading it tracked would cause infinite loops).
  $effect(() => {
    const feat = selectionStore.selectedFeature;
    const lid = selectionStore.selectedLayerId;
    if (feat && lid) {
      const geom = feat.geometry as Geometry | undefined;
      const fid = resolveFeatureId(feat);
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
  });

  // Dismiss featureSelected on drawing tool switch
  // Uses untrack() to avoid circular dependency (reads + writes interactionState).
  $effect(() => {
    const tool = selectionStore.activeTool;
    if (tool && tool !== 'select') {
      const currentType = untrack(() => interactionState.type);
      if (currentType === 'featureSelected') {
        transitionTo({ type: 'idle' });
      }
      // Don't clear drawRegion when tool is 'polygon' (user is drawing the region)
      if (currentType === 'drawRegion' && tool !== 'polygon') {
        transitionTo({ type: 'idle' });
      }
    }
  });

  // Feature pick capture — when in pickFeature mode and user clicks a feature
  // Uses untrack() to avoid circular dependency (reads + writes interactionState).
  $effect(() => {
    const feat = selectionStore.selectedFeature;
    const lid = selectionStore.selectedLayerId;
    if (feat && lid) {
      const current = untrack(() => interactionState);
      if (current.type === 'pickFeature' && !current.picked) {
        const fid = resolveFeatureId(feat);
        if (fid) {
          transitionTo({
            type: 'pickFeature',
            picked: { featureId: fid, layerId: lid },
          });
        }
      }
    }
  });

  // ── Annotation pin GeoJSON (derived from query cache) ──────────────────────
  // Annotations are stored as tRPC records but rendered via MapCanvas as a
  // dedicated GeoJSON source. Content is embedded in feature properties so the
  // popup can render without a second fetch.
  // These $derived values auto-update when any annotation mutation invalidates
  // the shared query cache — no manual refresh needed.
  const annotationRows = $derived(annotationPinsQuery.data ?? []);

  const annotationPins: AnnotationPinCollection = $derived({
    type: 'FeatureCollection',
    features: annotationRows
      .filter((a) => a.anchor.type === 'point' && !('parentId' in a && a.parentId))
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
  });

  const annotationRegions: AnnotationRegionCollection = $derived({
    type: 'FeatureCollection',
    features: annotationRows
      .filter((a) => a.anchor.type === 'region' && !('parentId' in a && a.parentId))
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
  });

  const annotatedFeaturesIndex: Map<string, { layerId: string; count: number }> = $derived.by(() => {
    const featureAnchored = annotationRows.filter(
      (a: { anchor: { type: string } }) => a.anchor.type === 'feature'
    );
    const featureMap = new Map<string, { layerId: string; count: number }>();
    for (const ann of featureAnchored) {
      const anchor = ann.anchor as { type: 'feature'; featureId: string; layerId: string };
      const key = anchor.featureId;
      const existing = featureMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        featureMap.set(key, { layerId: anchor.layerId, count: 1 });
      }
    }
    return featureMap;
  });

  const measurementAnnotationData: { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }[] } = $derived.by(() => {
    const measurementAnchored = annotationRows.filter(
      (a: { anchor: { type: string } }) => a.anchor.type === 'measurement'
    );
    const measurementFeatures = measurementAnchored.map((ann) => {
      const anchor = ann.anchor as { type: 'measurement'; geometry: { type: string; coordinates: unknown } };
      const body = ann.content.kind === 'single' ? ann.content.body : null;
      const label = body?.type === 'measurement' ? (body as { displayValue: string }).displayValue : '';
      return {
        type: 'Feature' as const,
        geometry: anchor.geometry,
        properties: { id: ann.id, label, annotationId: ann.id },
      };
    });
    return { type: 'FeatureCollection' as const, features: measurementFeatures };
  });

  // Initialize layers — untrack the store write to prevent reading _activeLayerId
  // inside set() from becoming a tracked dependency (causes effect_update_depth_exceeded).
  $effect(() => {
    const layers = initialLayers; // tracked: re-runs if prop changes (SPA nav)
    untrack(() => {
      layersStore.set(layers);
      for (const layer of layers) {
        if (!isLargeLayer(layer)) {
          loadLayerData(layer.id);
        }
      }
    });
  });

  // Viewport-based loading for large layers: listen to moveend on the map
  $effect(() => {
    const map = mapStore.mapInstance;
    const activeLayer = layersStore.active;
    if (!map || !activeLayer || !isLargeLayer(activeLayer)) return;

    map.on('moveend', handleMoveEnd);
    // Initial fetch for current viewport
    fetchViewportFeatures();

    return () => {
      map.off('moveend', handleMoveEnd);
      clearTimeout(moveEndTimer);
    };
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

    // 1/2/3 — switch drawing tools (only in editing mode, no modifier keys)
    if (!designMode && !mod && !e.shiftKey && !e.altKey) {
      switch (e.key) {
        case '1': selectionStore.setActiveTool('select'); break;
        case '2': selectionStore.setActiveTool('point'); break;
        case '3': selectionStore.setActiveTool('polygon'); break;
      }
    }
  }

  // Clear hot overlay features on component unmount
  $effect(() => {
    return () => {
      hotOverlay.clearHotFeatures();
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-screen w-full overflow-hidden bg-slate-900">
  <!-- Left: Layer Panel -->
  {#if !effectiveReadonly && !designMode}
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
      {#if userRole && userRole !== 'owner'}
        <span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/80 text-slate-300 capitalize">
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
            <Button variant="ghost" size="sm" class={showDataTable ? 'bg-slate-700 text-white' : ''} onclick={() => (showDataTable = !showDataTable)}>
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
        {annotationPins}
        {annotationRegions}
        {...(measureActive ? { onmeasured: (r: MeasurementResult) => { measureResult = r; } } : {})}
        {...(interactionState.type === 'drawRegion' && !interactionState.geometry ? { onregiondrawn: (g: { type: 'Polygon'; coordinates: number[][][] }) => { transitionTo({ type: 'drawRegion', geometry: g }); } } : {})}
        annotatedFeatures={annotatedFeaturesIndex}
        measurementAnnotations={measurementAnnotationData}
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

    <!-- Data table + filter panel (collapsible bottom panel) -->
    {#if showDataTable && layersStore.active}
      {@const activeLayer = layersStore.active}
      {@const rawFeatures = layerData[activeLayer.id]?.features ?? []}
      {@const filteredFeatures = filterStore.applyToFeatures(activeLayer.id, rawFeatures)}
      <div class="border-t border-white/10 shrink-0 flex flex-col overflow-hidden" style="height: {showFilterPanel && !isLargeLayer(activeLayer) ? '22rem' : '16rem'}">
        {#if isLargeLayer(activeLayer)}
          <div class="px-3 py-1.5 bg-blue-900/30 border-b border-blue-500/20 text-xs text-blue-300 flex items-center gap-2 shrink-0">
            <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>Large layer ({(activeLayer.featureCount ?? 0).toLocaleString()} features) — rendered via vector tiles. {viewportLoading ? 'Loading…' : 'Use the table to inspect features in the current viewport.'}</span>
          </div>
        {:else if showFilterPanel}
          <FilterPanel layerId={activeLayer.id} features={rawFeatures} />
        {/if}
        <div class="flex-1 min-h-0 overflow-hidden">
          {#if isLargeLayer(activeLayer)}
            <DataTable
              mode="server"
              serverRows={viewportRows}
              serverTotal={viewportTotal}
              serverPage={viewportPage}
              serverPageSize={viewportPageSize}
              onPageChange={handleViewportPageChange}
              onPageSizeChange={handleViewportPageSizeChange}
              onSortChange={handleViewportSortChange}
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
      <div class="flex border-b border-white/10 shrink-0">
        <button
          class="flex-1 py-2 text-xs font-medium text-center transition-colors
                 {analysisTab === 'measure'
                   ? 'text-blue-400 border-b-2 border-blue-400'
                   : 'text-slate-400 hover:text-slate-200'}"
          onclick={() => { analysisTab = 'measure'; }}
        >
          Measure
        </button>
        <button
          class="flex-1 py-2 text-xs font-medium text-center transition-colors
                 {analysisTab === 'process'
                   ? 'text-blue-400 border-b-2 border-blue-400'
                   : 'text-slate-400 hover:text-slate-200'}"
          onclick={() => { analysisTab = 'process'; }}
        >
          Process
        </button>
      </div>

      {#if analysisTab === 'measure'}
        <div class="p-4 flex-1">
          {#if measureResult === null}
            <div class="flex flex-col items-center justify-center py-8 text-center">
              <svg class="h-6 w-6 text-slate-500 mb-2" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M.5 14.5a.5.5 0 0 1-.354-.854l13-13a.5.5 0 0 1 .708.708l-13 13A.5.5 0 0 1 .5 14.5zM11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM8 3.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM5 .5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 5 .5z"/>
              </svg>
              <p class="text-sm text-slate-400">Draw a line to measure distance, or a polygon for area and perimeter.</p>
              <p class="text-xs text-slate-500 mt-1">Use the drawing tools on the left. Click to add points, double-click to finish. You can also select an existing feature and click "Measure" to measure it.</p>
            </div>
          {:else if measureResult.type === 'distance'}
            <div class="space-y-2">
              <span class="text-slate-400 text-xs uppercase tracking-wide">Distance</span>
              <p class="text-2xl font-mono font-semibold text-cyan-300 tabular-nums">
                {formatDistance(measureResult.distanceKm, distUnit)}
              </p>
              <div class="flex items-center gap-2">
                <select bind:value={distUnit} class="bg-slate-700 border border-white/10 rounded px-2 py-0.5 text-xs text-white" aria-label="Distance unit">
                  {#each DISTANCE_UNITS as u (u.value)}
                    <option value={u.value}>{u.label}</option>
                  {/each}
                </select>
                <span class="text-xs text-slate-500">{measureResult.vertexCount} {measureResult.vertexCount === 1 ? 'vertex' : 'vertices'}</span>
              </div>
            </div>
          {:else}
            <div class="space-y-2">
              <span class="text-slate-400 text-xs uppercase tracking-wide">Area</span>
              <p class="text-2xl font-mono font-semibold text-cyan-300 tabular-nums">
                {formatArea(measureResult.areaM2, areaUnit)}
              </p>
              <select bind:value={areaUnit} class="bg-slate-700 border border-white/10 rounded px-2 py-0.5 text-xs text-white" aria-label="Area unit">
                {#each AREA_UNITS as u (u.value)}
                  <option value={u.value}>{u.label}</option>
                {/each}
              </select>
              <div class="mt-2">
                <span class="text-slate-400 text-xs uppercase tracking-wide">Perimeter</span>
                <p class="text-lg font-mono font-semibold text-emerald-300 tabular-nums">
                  {formatDistance(measureResult.perimeterKm, periUnit)}
                </p>
                <select bind:value={periUnit} class="bg-slate-700 border border-white/10 rounded px-2 py-0.5 text-xs text-white" aria-label="Perimeter unit">
                  {#each DISTANCE_UNITS as u (u.value)}
                    <option value={u.value}>{u.label}</option>
                  {/each}
                </select>
              </div>
              <span class="text-xs text-slate-500">{measureResult.vertexCount} {measureResult.vertexCount === 1 ? 'vertex' : 'vertices'}</span>
            </div>
          {/if}
          {#if measureResult !== null}
            <div class="flex items-center gap-3 mt-3">
              <button onclick={() => { measureResult = null; }} class="text-xs text-slate-400 hover:text-white transition-colors">
                Clear measurement
              </button>
              <button
                type="button"
                class="text-xs px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white"
                onclick={() => {
                  if (!measureResult) return;
                  const mr = measureResult;
                  if (mr.type === 'distance') {
                    transitionTo({
                      type: 'pendingMeasurement',
                      anchor: {
                        type: 'measurement',
                        geometry: { type: 'LineString', coordinates: mr.coordinates as [number, number][] },
                      },
                      content: {
                        type: 'measurement',
                        measurementType: 'distance',
                        value: mr.distanceKm * 1000,
                        unit: distUnit,
                        displayValue: formatDistance(mr.distanceKm, distUnit),
                      },
                    });
                  } else {
                    transitionTo({
                      type: 'pendingMeasurement',
                      anchor: {
                        type: 'measurement',
                        geometry: { type: 'Polygon', coordinates: mr.coordinates as [number, number][][] },
                      },
                      content: {
                        type: 'measurement',
                        measurementType: 'area',
                        value: mr.areaM2,
                        unit: areaUnit,
                        displayValue: formatArea(mr.areaM2, areaUnit),
                      },
                    });
                  }
                  activeSection = 'annotations';
                }}
              >
                Save as annotation
              </button>
            </div>
          {/if}
        </div>
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
