<script lang="ts">
  import { effectEnter, effectExit } from '$lib/debug/effect-tracker.js';
  import { browser } from '$app/environment';
  import { trpc } from '$lib/utils/trpc.js';
  import { getLayersStore } from '$lib/stores/layers.svelte.js';
  const layersStore = getLayersStore();
  import { getMapStore } from '$lib/stores/map.svelte.js';
  const mapStore = getMapStore();
  import { FiltersStore } from '$lib/stores/filters-store.svelte.js';
  import { setMapEditorState } from '$lib/stores/map-editor-state.svelte.js';
  import { EditorLayout } from '$lib/stores/editor-layout.svelte.js';
  import { getUndoStore } from '$lib/stores/undo.svelte.js';
  const undoStore = getUndoStore();
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import MapCanvas from './MapCanvas.svelte';
  import LayerPanel from './LayerPanel.svelte';
  import BasemapPicker from './BasemapPicker.svelte';
  import type { Layer, LayerStyle } from '@felt-like-it/shared-types';
  import DataTable from '$lib/components/data/DataTable.svelte';
  import { annotationsToLayerFeatureRows } from '$lib/components/data/annotation-row-mapper.js';
  import FilterPanel from '$lib/components/data/FilterPanel.svelte';
  import ImportDialog from '$lib/components/data/ImportDialog.svelte';
  import ExportDialog from '$lib/components/data/ExportDialog.svelte';
  import StylePanel from '$lib/components/style/StylePanel.svelte';
  import Legend from '$lib/components/style/Legend.svelte';
  import { getStyleStore } from '$lib/stores/style.svelte.js';
  const styleStore = getStyleStore();
  import Button from '$lib/components/ui/Button.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import ActivityFeed from './ActivityFeed.svelte';
  import ShareDialog from './ShareDialog.svelte';
  import GeoprocessingPanel from '$lib/components/geoprocessing/GeoprocessingPanel.svelte';
  import AnnotationPanel from '$lib/components/annotations/AnnotationPanel.svelte';
  import SidePanel from './SidePanel.svelte';
  import { createAnnotationGeoStore } from '$lib/stores/annotation-geo.svelte.js';
  import { createViewportStore } from '$lib/stores/viewport.svelte.js';
  import type { DistanceMeasurement, AreaMeasurement } from '@felt-like-it/geo-engine';
  import { measureLine, measurePolygon } from '@felt-like-it/geo-engine';
  import MeasurementPanel from './MeasurementPanel.svelte';
  import { MeasurementStore } from '$lib/stores/measurement-store.svelte.js';
  import MeasurementTooltip from '$lib/components/measurements/MeasurementTooltip.svelte';
  import DrawActionRow from './DrawActionRow.svelte';
  import StatusBar from './StatusBar.svelte';
  import { useLayerDataManager } from './useLayerDataManager.svelte.js';
  import { useMeasurementTooltip } from './useMeasurementTooltip.svelte.js';
  import { useCursorStatus } from './useCursorStatus.svelte.js';
  // useInteractionBridge removed — replaced by MapEditorState atomic methods
  import { useKeyboardShortcuts } from './useKeyboardShortcuts.svelte.js';
  import { useViewportSave } from './useViewportSave.svelte.js';
  import { ActivityStore } from '$lib/stores/activity-store.svelte.js';
  import { getErrorCode } from '$lib/utils/handle-error.js';
  import { PUBLIC_MARTIN_URL } from '$env/static/public';
  import { VECTOR_TILE_THRESHOLD } from '$lib/utils/constants.js';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { queryKeys } from '$lib/utils/query-keys.js';
  import { getHotOverlayStore } from '$lib/utils/map-sources.svelte.js';
  const hotOverlay = getHotOverlayStore();
  // interactionModes removed — replaced by MapEditorState

  function isLargeLayer(layer: Layer): boolean {
    return PUBLIC_MARTIN_URL.length > 0 && (layer.featureCount ?? 0) > VECTOR_TILE_THRESHOLD;
  }

  // ── Unified editor state (replaces interactionModes + selectionStore + drawingStore) ──
  const editorState = setMapEditorState();

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

  let {
    mapId,
    mapTitle,
    initialLayers,
    userId,
    readonly = false,
    embed = false,
    isOwner = false,
    userRole,
  }: Props = $props();

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
    return () => {
      mapStore.setMapContainerEl(undefined);
    };
  });

  // ── Filter store (map-scoped, URL-reflected) ──────────────────────────────
  const filtersStore = new FiltersStore(() => mapId);

  // ── Viewport persistence ──────────────────────────────────────────────────
  useViewportSave({
    get mapId() { return mapId; },
    getMapInstance: () => mapStore.mapInstance ?? undefined,
    saveViewportLocally: (id) => mapStore.saveViewportLocally(id),
  });

  // Layer data management (loading, caching, init)
  const layerDataManager = useLayerDataManager({
    getInitialLayers: () => initialLayers,
    queryClient: mapQueryClient,
    queryKeysFn: (layerId) => queryKeys.features.list({ layerId }),
    fetchLayerFn: (layerId) => trpc.features.list.query({ layerId }),
    isLargeLayer,
    getMapInstance: () => mapStore.mapInstance ?? undefined,
    layersStore,
    onError: (msg) => toastStore.error(msg),
  });
  const { loadLayerData, handleLayerChange } = layerDataManager;
  // Re-export layerData as a derived alias for template access
  const layerData = $derived(layerDataManager.layerData);

  // ── Unified panel layout state (replaces activePanelIcon, activeSection, editorLayout.bottomPanel === 'table', dialogs) ──
  const editorLayout = new EditorLayout();
  // Initialize from URL params
  const urlState = EditorLayout.fromSearchParams(
    new URLSearchParams(browser ? window.location.search : '')
  );
  editorLayout.leftPanel = urlState.leftPanel ?? 'layers';
  editorLayout.rightSection = urlState.rightSection ?? 'annotations';
  editorLayout.bottomPanel = urlState.bottomPanel;
  editorLayout.activeDialog = urlState.activeDialog;
  editorLayout.sidePanelCollapsed = urlState.sidePanelCollapsed;
  editorLayout.filterPanelOpen = urlState.filterPanelOpen;

  // Sync to URL on state changes (debounced via requestAnimationFrame in syncToUrl)
  $effect(() => {
    editorLayout.syncToUrl();
  });

  // ── Dialog open state — derived from editorLayout.activeDialog ──
  // Single source of truth: editorLayout.activeDialog. Each dialog reads its
  // boolean via a $derived; child writes (e.g. internal `open = false` on
  // Cancel) flow back through bind:get,set, which clears activeDialog atomically.
  const importDialogOpen = $derived(editorLayout.activeDialog === 'import');
  const exportDialogOpen = $derived(editorLayout.activeDialog === 'export');
  const shareDialogOpen = $derived(editorLayout.activeDialog === 'share');

  function closeAllDialogs() {
    editorLayout.openDialog(null);
  }

  let savingViewport = $state(false);

  // ── Measurement store (extracted from local state — F09) ──────────────────
  const measurementStore = new MeasurementStore();

  // ── Measurement tooltip position + active state ───────────────────────────
  const measurement = useMeasurementTooltip({
    getMeasurementStore: () => measurementStore,
    getMap: () => mapStore.mapInstance ?? undefined,
    getDesignMode: () => designMode,
  });

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
  let analysisTab = $state<'measure' | 'process'>('process');

  // ── Activity tracking (counts for sidebar badges, event logging) ─────────
  const activityStore = new ActivityStore(
    (action, metadata) =>
      trpc.events.log.mutate({ mapId, action, metadata }).catch(() => undefined)
  );

  // ── Interaction state (discriminated union) ───────────────────────────────
  // State lives in MapEditorState class, provided via Svelte 5 context.
  const { transitionTo } = editorState;
  const interactionState = $derived(editorState.interactionState);

  // Section/design-mode reactions (replaces useInteractionBridge effects)
  // NOTE: handleSectionChange removed — panel layout is now orthogonal to interaction modes
  // (see F12 design: no silent mode cancellation on panel change)
  $effect(() => {
    editorState.handleDesignModeChange(designMode);
  });

  // ── Annotation pin GeoJSON (derived from query cache) ──────────────────────
  // Annotations are stored as tRPC records but rendered via MapCanvas as a
  // dedicated GeoJSON source. Content is embedded in feature properties so the
  // popup can render without a second fetch.
  // These derived values auto-update when any annotation mutation invalidates
  // the shared query cache — no manual refresh needed.
  const annotationGeo = createAnnotationGeoStore(() => annotationPinsQuery.data ?? []);

  // Viewport-based loading for large layers
  $effect(() => {
    const map = mapStore.mapInstance;
    const activeLayer = layersStore.active;
    effectEnter('ME:viewportLoading', { hasMap: !!map, activeLayer: activeLayer?.id });
    if (!map || !activeLayer || !isLargeLayer(activeLayer)) {
      effectExit('ME:viewportLoading');
      return;
    }

    return viewportStore.bindMap(map);
  });

  // TerraDraw commits flow into annotation_objects (Phase 3 unified model).
  // Re-render is owned by createAnnotationMutationOptions cache invalidation;
  // this handler covers the single cross-cutting concern the cache can't:
  // logging the user action.
  function handleAnnotationDrawn(annotation: { id: string; anchorType: string }) {
    activityStore.log('annotation.drawn', {
      annotationId: annotation.id,
      anchorType: annotation.anchorType,
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
    } catch (err: unknown) {
      if (getErrorCode(err) === 'CONFLICT') {
        toastStore.error('Map was modified by another user. Please reload.');
      } else {
        toastStore.error('Failed to save viewport.');
      }
    } finally {
      savingViewport = false;
    }
  }

  async function handleImportComplete(layerId: string) {
    editorLayout.openDialog(null);
    layersStore.setActive(layerId);
    // Re-fetch layers to get updated featureCount, then load data if not large
    try {
      const newLayers = await trpc.layers.list.query({ mapId });
      layersStore.set(newLayers);
      const imported = newLayers.find((l) => l.id === layerId);
      if (imported && !isLargeLayer(imported)) {
        await loadLayerData(layerId);
      }
      trpc.events.log
        .mutate({ mapId, action: 'layer.imported', metadata: { name: imported?.name ?? '' } })
        .catch(() => undefined);
    } catch {
      toastStore.error('Failed to refresh layers after import.');
    }
  }

  // Keyboard shortcuts composable
  const { handleKeydown } = useKeyboardShortcuts({
    getEffectiveReadonly: () => effectiveReadonly,
    getDesignMode: () => designMode,
    getInteractionState: () => interactionState,
    transitionTo,
    undoStore,
    selectionStore: editorState,
    toggleDesignMode: () => {
      designMode = !designMode;
    },
    toggleMeasurement: () => {
      measurementStore.toggle();
    },
  });

  // Clear hot overlay features on component unmount
  $effect(() => {
    effectEnter('ME:hotOverlayCleanup');
    effectExit('ME:hotOverlayCleanup');
    return () => {
      hotOverlay.clearHotFeatures();
    };
  });

  // ── Status bar: cursor position + zoom level ───────────────────────────────
  const cursorStatus = useCursorStatus({ getMap: () => mapStore.mapInstance ?? undefined });
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="flex h-screen w-full overflow-hidden bg-surface">
  <!-- Left: Icon rail + LayerPanel flyout -->
  {#if !effectiveReadonly && !designMode}
    <!-- Icon rail -->
    <div
      class="w-[52px] shrink-0 flex flex-col items-center pt-2 gap-1 bg-surface-container border-r border-surface-high"
    >
      <button
        class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg transition-colors w-full {editorLayout.leftPanel ===
        'layers'
          ? 'bg-surface-high text-primary'
          : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface'}"
        onclick={() => {
          editorLayout.openLeftPanel(editorLayout.leftPanel === 'layers' ? null : 'layers');
        }}
        title="Layers"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          ><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" /></svg
        >
        <span class="text-[8px] font-display uppercase tracking-wider">Layers</span>
      </button>
      <button
        class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg transition-colors w-full {editorLayout.leftPanel ===
        'processing'
          ? 'bg-surface-high text-primary'
          : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface'}"
        onclick={() => {
          editorLayout.openLeftPanel(editorLayout.leftPanel === 'processing' ? null : 'processing');
        }}
        title="Analysis"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          ><path
            d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"
          /></svg
        >
        <span class="text-[8px] font-display uppercase tracking-wider">Analysis</span>
      </button>
      <button
        class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg transition-colors w-full {editorLayout.bottomPanel ===
        'table'
          ? 'bg-surface-high text-primary'
          : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface'}"
        onclick={() => {
          editorLayout.toggleBottomPanel();
        }}
        title="Tables"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          ><path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18" /></svg
        >
        <span class="text-[8px] font-display uppercase tracking-wider">Tables</span>
      </button>
      <button
        class="flex flex-col items-center gap-0.5 px-2 py-2 rounded-lg transition-colors w-full {editorLayout.activeDialog ===
        'export'
          ? 'bg-surface-high text-primary'
          : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface'}"
        onclick={() => {
          editorLayout.openDialog('export');
        }}
        title="Export"
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"
          ><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg
        >
        <span class="text-[8px] font-display uppercase tracking-wider">Export</span>
      </button>
    </div>
    <!-- LayerPanel flyout -->
    {#if editorLayout.leftPanel === 'layers'}
      <div class="w-56 shrink-0 flex flex-col bg-surface-container border-r border-surface-high">
        <LayerPanel {mapId} onlayerchange={handleLayerChange} />
      </div>
    {/if}
  {/if}

  <!-- Center: Map + toolbar -->
  <div class="flex-1 relative flex flex-col min-w-0">
    <!-- Top toolbar — hidden in embed mode (bare map canvas only) -->
    {#if !embed}
      <div
        class="flex items-center gap-1 px-3 py-2 bg-surface-container border-b border-surface-high shrink-0"
      >
        <span class="text-sm font-medium font-display text-on-surface truncate mr-auto"
          >{mapTitle}</span
        >
        {#if userRole && userRole !== 'owner'}
          <span
            class="text-[10px] px-1.5 py-0.5 rounded bg-surface-high/80 text-on-surface-variant capitalize"
          >
            {userRole}
          </span>
        {/if}

        {#if !effectiveReadonly}
          <!-- Design mode toggle -->
          <Tooltip
            content={designMode
              ? 'Exit style editor — back to map editing (Ctrl+\\)'
              : 'Style editor — customize colors, sizes, and layer appearance (Ctrl+\\)'}
          >
            <Button
              variant={designMode ? 'primary' : 'ghost'}
              size="sm"
              onclick={() => {
                designMode = !designMode;
              }}
            >
              <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path
                  d="M12.854.146a.5.5 0 00-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 000-.708l-3-3zM13.5 6.207L9.793 2.5 3.622 8.671a.5.5 0 00-.121.196l-1.458 4.374a.5.5 0 00.632.632l4.374-1.458a.5.5 0 00.196-.121L13.5 6.207z"
                />
              </svg>
              Style
            </Button>
          </Tooltip>

          {#if !designMode}
            <Tooltip
              content="Import — add data from files (GeoJSON, CSV, Shapefile, KML, GPX, GeoPackage)"
            >
              <Button variant="ghost" size="sm" onclick={() => editorLayout.openDialog('import')}>
                <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path
                    d="M.5 9.9a.5.5 0 01.5.5v2.5a1 1 0 001 1h12a1 1 0 001-1v-2.5a.5.5 0 011 0v2.5a2 2 0 01-2 2H2a2 2 0 01-2-2v-2.5a.5.5 0 01.5-.5z"
                  />
                  <path
                    d="M7.646 1.146a.5.5 0 01.708 0l3 3a.5.5 0 01-.708.708L8.5 2.707V11.5a.5.5 0 01-1 0V2.707L5.354 4.854a.5.5 0 11-.708-.708l3-3z"
                  />
                </svg>
                Import
              </Button>
            </Tooltip>

            <Tooltip content="Export — download layer data as GeoJSON, CSV, or other formats">
              <Button variant="ghost" size="sm" onclick={() => editorLayout.openDialog('export')}>
                <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path
                    d="M.5 9.9a.5.5 0 01.5.5v2.5a1 1 0 001 1h12a1 1 0 001-1v-2.5a.5.5 0 011 0v2.5a2 2 0 01-2 2H2a2 2 0 01-2-2v-2.5a.5.5 0 01.5-.5z"
                  />
                  <path
                    d="M7.646 11.854a.5.5 0 00.708 0l3-3a.5.5 0 00-.708-.708L8.5 10.293V1.5a.5.5 0 00-1 0v8.793L5.354 8.146a.5.5 0 10-.708.708l3 3z"
                  />
                </svg>
                Export
              </Button>
            </Tooltip>

            <Tooltip
              content="Data table — view and browse all features in the active layer as rows"
            >
              <Button
                variant="ghost"
                size="sm"
                class={editorLayout.bottomPanel === 'table'
                  ? 'bg-surface-high text-on-surface'
                  : ''}
                onclick={() => editorLayout.toggleBottomPanel()}
              >
                <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path
                    d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm15 2h-4v3h4V4zm0 4h-4v3h4V8zm0 4h-4v3h3a1 1 0 001-1v-2zm-5 3v-3H6v3h4zm-5 0v-3H1v2a1 1 0 001 1h3zm-4-4h4V8H1v3zm0-4h4V4H1v3zm5-3v3h4V4H6zm4 4H6v3h4V8z"
                  />
                </svg>
                Table
              </Button>
            </Tooltip>

            <Tooltip
              content="Filter — show only features matching specific attribute values (e.g. 'type = park')"
            >
              <Button
                variant="ghost"
                size="sm"
                onclick={() => {
                  editorLayout.toggleBottomPanel();
                  editorLayout.toggleFilterPanel();
                }}
              >
                <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path
                    d="M6 10.5a.5.5 0 01.5-.5h3a.5.5 0 010 1h-3a.5.5 0 01-.5-.5zm-2-3a.5.5 0 01.5-.5h7a.5.5 0 010 1h-7a.5.5 0 01-.5-.5zm-2-3a.5.5 0 01.5-.5h11a.5.5 0 010 1h-11a.5.5 0 01-.5-.5z"
                  />
                </svg>
                Filter
                {#if filtersStore.conditions.length > 0}
                  <span class="rounded-full bg-primary px-1 text-xs font-semibold leading-tight">
                    {filtersStore.conditions.length}
                  </span>
                {/if}
              </Button>
            </Tooltip>

            <Tooltip
              content="Lock viewport — saves current position and zoom as the default view whenever anyone opens this map"
            >
              <Button variant="ghost" size="sm" onclick={saveViewport} loading={savingViewport}>
                <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path
                    d="M8 1a2 2 0 0 0-2 2v4H5a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2H7V3a1 1 0 0 1 2 0v1a.5.5 0 0 0 1 0V3a2 2 0 0 0-2-2z"
                  />
                </svg>
                Lock View
              </Button>
            </Tooltip>

            <div class="mx-0.5 h-5 w-px bg-surface-high"></div>

            <Tooltip
              content={undoStore.undoLabel ? `Undo: ${undoStore.undoLabel}` : 'Undo (Ctrl+Z)'}
            >
              <Button
                variant="ghost"
                size="sm"
                onclick={() => undoStore.undo()}
                disabled={!undoStore.canUndo}
                aria-label="Undo"
              >
                <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 1a7 7 0 110 14A7 7 0 018 1zm0 1a6 6 0 100 12A6 6 0 008 2z" />
                  <path
                    d="M5.354 7.354a.5.5 0 010-.708l2-2a.5.5 0 01.708.708L6.707 6.7H10a2.5 2.5 0 010 5H8.5a.5.5 0 010-1H10a1.5 1.5 0 000-3H6.707l1.355 1.346a.5.5 0 11-.708.708l-2-2z"
                  />
                </svg>
              </Button>
            </Tooltip>

            <Tooltip
              content={undoStore.redoLabel ? `Redo: ${undoStore.redoLabel}` : 'Redo (Ctrl+Shift+Z)'}
            >
              <Button
                variant="ghost"
                size="sm"
                onclick={() => undoStore.redo()}
                disabled={!undoStore.canRedo}
                aria-label="Redo"
              >
                <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2z" />
                  <path
                    d="M10.646 7.354a.5.5 0 000-.708l-2-2a.5.5 0 00-.708.708L9.293 6.7H6a2.5 2.5 0 000 5h1.5a.5.5 0 000-1H6a1.5 1.5 0 010-3h3.293L7.938 9.054a.5.5 0 10.708.708l2-2z"
                  />
                </svg>
              </Button>
            </Tooltip>

            <div class="flex-1"></div>

            <Tooltip content="Share — invite collaborators, create embed links, or manage access">
              <Button variant="ghost" size="sm" onclick={() => editorLayout.openDialog('share')}>
                <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path
                    d="M13.5 1a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM11 2.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zm-5.5 3a1.5 1.5 0 100 3 1.5 1.5 0 000-3zM3 7a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0zm9 4.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3zm-2.5 1.5a2.5 2.5 0 115 0 2.5 2.5 0 01-5 0z"
                  />
                  <path d="M7.5 6.35l4-2.3.5.87-4 2.3-.5-.87zm0 4.3l4 2.3.5-.87-4-2.3-.5.87z" />
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
        {filtersStore}
        onannotationdrawn={handleAnnotationDrawn}
        annotationPins={annotationGeo.pins}
        annotationRegions={annotationGeo.regions}
        annotationPaths={annotationGeo.paths}
        {...measurement.measureActive
          ? {
              onmeasured: (r: DistanceMeasurement | AreaMeasurement) => {
                measurementStore.setResult(r);
              },
            }
          : {}}
        {...interactionState.type === 'drawRegion' && !interactionState.geometry
          ? {
              onregiondrawn: (g: { type: 'Polygon'; coordinates: number[][][] }) => {
                transitionTo({ type: 'drawRegion', geometry: g });
              },
            }
          : {}}
        annotatedFeatures={annotationGeo.index}
        measurementAnnotations={annotationGeo.measurements}
        onbadgeclick={(_featureId) => {
          editorLayout.rightSection = 'annotations';
        }}
        onfeatureannotate={({ featureId, layerId }) => {
          // Feature popup's Annotate CTA — routes into the annotation panel.
          // The form pre-fills via `pickedFeature`. Scroll-to-feature was
          // never wired to a real implementation; removed when the no-op
          // effect in AnnotationPanel was deleted.
          transitionTo({
            type: 'pickFeature',
            picked: { featureId, layerId },
          });
          editorLayout.rightSection = 'annotations';
        }}
      />

      <!-- Measurement tooltip (floating overlay when measurement is active with result) -->
      {#if measurementStore.currentResult && measurementStore.active}
        <MeasurementTooltip
          result={measurementStore.currentResult}
          position={measurement.tooltipPos}
          onsave={() => {
            const payload = measurementStore.saveAsAnnotation();
            if (payload) {
              transitionTo({
                type: 'pendingMeasurement',
                anchor: {
                  type: 'measurement',
                  geometry: payload.geometry,
                },
                content: {
                  type: 'measurement',
                  measurementType: measurementStore.currentResult?.type ?? 'distance',
                  value: measurementStore.currentResult?.value ?? 0,
                  unit: measurementStore.currentResult?.type === 'distance' ? 'km' : 'km2',
                  displayValue: payload.title,
                },
              });
              editorLayout.rightSection = 'annotations';
            }
          }}
          onclear={() => {
            measurementStore.clear();
          }}
        />
      {/if}

      {#if effectiveReadonly}
        <div
          class="absolute top-3 right-3 z-10 rounded bg-surface-container px-2 py-1 text-xs text-on-surface-variant shadow-sm"
        >
          View Only
        </div>
      {/if}

      {#if interactionState.type === 'drawRegion' && !interactionState.geometry}
        <div
          class="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-primary-container text-white text-xs px-3 py-1.5 rounded-full shadow-lg"
        >
          Draw a polygon to define the annotation region ·
          <button
            class="underline ml-1"
            onclick={() => {
              transitionTo({ type: 'idle' });
            }}>Cancel (Esc)</button
          >
        </div>
      {:else if interactionState.type === 'pickFeature' && !interactionState.picked}
        <div
          class="absolute top-2 left-1/2 -translate-x-1/2 z-50 bg-amber-600 text-white text-xs px-3 py-1.5 rounded-full shadow-lg"
        >
          Click a feature to attach annotation ·
          <button
            class="underline ml-1"
            onclick={() => {
              transitionTo({ type: 'idle' });
            }}>Cancel (Esc)</button
          >
        </div>
      {/if}

      {#if interactionState.type === 'featureSelected' && !measurement.measureActive}
        <div class="absolute bottom-16 left-1/2 -translate-x-1/2 z-40">
          <DrawActionRow
            onannotate={() => {
              if (interactionState.type === 'featureSelected') {
                const { feature } = interactionState;
                transitionTo({
                  type: 'pickFeature',
                  picked: { featureId: feature.featureId, layerId: feature.layerId },
                });
                editorLayout.rightSection = 'annotations';
              }
            }}
            onmeasure={() => {
              if (interactionState.type !== 'featureSelected') return;
              const { geometry } = interactionState.feature;
              transitionTo({ type: 'idle' });
              if (geometry.type === 'LineString') {
                measurementStore.setResult(measureLine(geometry.coordinates as [number, number][]));
              } else if (geometry.type === 'Polygon') {
                measurementStore.setResult(
                  measurePolygon(geometry.coordinates as [number, number][][])
                );
              }
              editorLayout.rightSection = 'analysis';
              analysisTab = 'measure';
            }}
            ondismiss={() => {
              transitionTo({ type: 'idle' });
            }}
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
    <StatusBar cursorLat={cursorStatus.cursorLat} cursorLng={cursorStatus.cursorLng} currentZoom={cursorStatus.currentZoom} />

    <!-- Data table + filter panel (collapsible bottom panel) -->
    {#if editorLayout.bottomPanel === 'table' && layersStore.active}
      {@const activeLayer = layersStore.active}
      {@const rawFeatures = layerData[activeLayer.id]?.features ?? []}
      <div
        class="border-t border-surface-high shrink-0 flex flex-col overflow-hidden"
        style:height={editorLayout.filterPanelOpen && !isLargeLayer(activeLayer)
          ? '22rem'
          : '16rem'}
      >
        {#if isLargeLayer(activeLayer)}
          <div
            class="px-3 py-1.5 bg-tertiary/10 border-b border-white/5 text-xs text-primary/80 flex items-center gap-2 shrink-0"
          >
            <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span
              >Large layer ({(activeLayer.featureCount ?? 0).toLocaleString()} features) — rendered via
              vector tiles. {viewportStore.loading
                ? 'Loading…'
                : 'Use the table to inspect features in the current viewport.'}</span
            >
          </div>
        {:else if editorLayout.filterPanelOpen}
          <FilterPanel store={filtersStore} layerId={activeLayer.id} features={rawFeatures} />
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
              onSelectFeature={(f) => editorState.selectFeature(f)}
            />
          {:else}
            <!--
              Phase 3 Wave D-α (D.4-A): small-layer DataTable shows ANNOTATIONS
              for the active layer, not raw features. User-curated rows (drawn
              shapes, labelled, styled) are the editing surface. Imported
              feature data is still rendered on the map; the per-layer DataTable
              just no longer surfaces it. Large layers continue to read features
              via viewportStore (server-paginated tile data).
            -->
            {@const layerAnnotationRows = annotationsToLayerFeatureRows(
              annotationPinsQuery.data ?? [],
              activeLayer.id,
            )}
            <DataTable
              features={layerAnnotationRows}
              style={activeLayer.style as LayerStyle}
              onSelectFeature={(f) => editorState.selectFeature(f)}
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
      {...userId !== undefined ? { userId } : {}}
      onannotationsaved={(action) => {
        if (action === 'created') {
          if (interactionState.type === 'drawRegion' || interactionState.type === 'pickFeature') {
            transitionTo({ type: 'idle' });
          }
        }
        if (action) {
          activityStore.log(`annotation.${action}`);
        }
      }}
      onrequestregion={() => {
        transitionTo({ type: 'drawRegion' });
      }}
      onrequestfeaturepick={() => {
        transitionTo({ type: 'pickFeature' });
      }}
      regionGeometry={interactionState.type === 'drawRegion'
        ? interactionState.geometry
        : undefined}
      pickedFeature={interactionState.type === 'pickFeature' ? interactionState.picked : undefined}
      pendingMeasurement={interactionState.type === 'pendingMeasurement'
        ? { anchor: interactionState.anchor, content: interactionState.content }
        : null}
      oncountchange={(a, c) => {
        activityStore.annotationCount = a;
        activityStore.commentCount = c;
      }}
    />
  {/snippet}

  {#snippet analysisContent()}
    <div class="flex flex-col h-full">
      <!-- Sub-tab switcher -->
      <div class="flex border-b border-surface-high shrink-0">
        <button
          class="flex-1 py-2 text-xs font-display uppercase tracking-wide font-medium text-center transition-colors
                 {analysisTab === 'measure'
            ? 'text-primary border-b-2 border-primary'
            : 'text-on-surface-variant hover:text-on-surface'}"
          onclick={() => {
            analysisTab = 'measure';
          }}
        >
          Measure
        </button>
        <button
          class="flex-1 py-2 text-xs font-display uppercase tracking-wide font-medium text-center transition-colors
                 {analysisTab === 'process'
            ? 'text-primary border-b-2 border-primary'
            : 'text-on-surface-variant hover:text-on-surface'}"
          onclick={() => {
            analysisTab = 'process';
          }}
        >
          Spatial Tools
        </button>
      </div>

      {#if analysisTab === 'measure'}
        <MeasurementPanel
          measureResult={measurementStore.currentResult}
          onclear={() => {
            measurementStore.clear();
          }}
          onsaveasannotation={(payload) => {
            transitionTo(payload);
            editorLayout.rightSection = 'annotations';
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
            activityStore.log('geoprocessing.completed', {
              outputLayerId: layerId,
              outputLayerName: newLayer?.name ?? '',
            });
          }}
        />
      {/if}
    </div>
  {/snippet}

  {#snippet activityContent()}
    <ActivityFeed
      {mapId}
      embedded
      refreshTrigger={activityStore.refreshTrigger}
      oncountchange={(n) => {
        activityStore.eventCount = n;
      }}
    />
  {/snippet}

  <!-- Right: Side panel (hidden in design mode and embed) -->
  {#if !designMode && !embed}
    <SidePanel
      sections={[
        {
          id: 'annotations',
          label: 'Annotations',
          icon: 'M8 1a6 6 0 100 12A6 6 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3a1 1 0 011 1v2h2a1 1 0 010 2H9v2a1 1 0 01-2 0v-2H5a1 1 0 010-2h2V6a1 1 0 011-1z',
          count: activityStore.badgeCount,
          helpText:
            'Add notes, comments, and observations to specific places on the map. Pin annotations to points, draw regions, or attach them to existing features.',
          content: annotationsContent,
        },
        {
          id: 'analysis',
          label: 'Measure & Tools',
          icon: 'M.5 14.5a.5.5 0 0 1-.354-.854l13-13a.5.5 0 0 1 .708.708l-13 13A.5.5 0 0 1 .5 14.5zM11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM8 3.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM5 .5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 5 .5z',
          helpText:
            'Measure distances and areas by drawing on the map, or run spatial operations to create new layers from existing data.',
          content: analysisContent,
        },
        {
          id: 'activity',
          label: 'Activity',
          icon: 'M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm14.5 5.5h-13v1h13v-1zM2 4.5h12v1H2v-1zm0 4h8v1H2v-1z',
          count: activityStore.eventCount,
          helpText:
            'A timeline of all changes to this map — imports, edits, annotations, and viewport saves. Useful for tracking who did what and when.',
          content: activityContent,
        },
      ]}
      activeSection={editorLayout.rightSection}
      collapsed={editorLayout.sidePanelCollapsed}
      onchange={(s) => {
        editorLayout.rightSection = s;
      }}
      oncollapse={() => {
        editorLayout.toggleSidePanelCollapse();
      }}
    />
  {/if}
</div>

<!-- Dialogs -->
{#if editorLayout.activeDialog === 'import'}
  <ImportDialog
    {mapId}
    bind:open={() => importDialogOpen, (v) => { if (!v) editorLayout.openDialog(null); }}
    onimported={handleImportComplete}
  />
{/if}

{#if editorLayout.activeDialog === 'export'}
  <ExportDialog
    layers={layersStore.all}
    {mapId}
    bind:open={() => exportDialogOpen, (v) => { if (!v) editorLayout.openDialog(null); }}
  />
{/if}

{#if editorLayout.activeDialog === 'share'}
  <ShareDialog
    {mapId}
    bind:open={() => shareDialogOpen, (v) => { if (!v) editorLayout.openDialog(null); }}
    onclose={closeAllDialogs}
    {isOwner}
    {...userId !== undefined ? { userId } : {}}
  />
{/if}
