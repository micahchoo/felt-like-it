<script lang="ts">
  import { trpc } from '$lib/utils/trpc.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import { filterStore } from '$lib/stores/filters.svelte.js';
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
  import Button from '$lib/components/ui/Button.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import ActivityFeed from './ActivityFeed.svelte';
  import CommentPanel from './CommentPanel.svelte';
  import CollaboratorsPanel from './CollaboratorsPanel.svelte';
  import GeoprocessingPanel from '$lib/components/geoprocessing/GeoprocessingPanel.svelte';

  interface Props {
    mapId: string;
    mapTitle: string;
    initialLayers: Layer[];
    /** ID of the authenticated user — used by CommentPanel to gate delete/resolve buttons. */
    userId?: string;
    readonly?: boolean;
  }

  let { mapId, mapTitle, initialLayers, userId, readonly = false }: Props = $props();

  // DOM element wrapping the map canvas + legend overlay — used for high-res PNG export
  let mapAreaEl = $state<HTMLDivElement | undefined>(undefined);
  $effect(() => { mapStore.setMapContainerEl(mapAreaEl); });

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
  let savingViewport = $state(false);

  // Initialize layers
  $effect(() => {
    layersStore.set(initialLayers);
    // Load GeoJSON for all initial layers
    for (const layer of initialLayers) {
      loadLayerData(layer.id);
    }
  });

  async function loadLayerData(layerId: string) {
    try {
      const fc = await trpc.features.list.query({ layerId });
      const featureCollection = fc as { type: 'FeatureCollection'; features: GeoJSONFeature[] };
      layerData = { ...layerData, [layerId]: featureCollection };

      // Push data directly to the MapLibre source to bypass svelte-maplibre-gl's
      // firstRun guard, which only sets data after the source is first registered.
      const map = mapStore.mapInstance;
      const src = map?.getSource(`source-${layerId}`);
      if (src && 'setData' in src) {
        (src as { setData: (_data: unknown) => void }).setData(featureCollection);
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
      });
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
      layersStore.set(newLayers as unknown as Layer[]);
      const imported = (newLayers as { id: string; name: string }[]).find((l) => l.id === layerId);
      trpc.events.log
        .mutate({ mapId, action: 'layer.imported', metadata: { name: imported?.name ?? '' } })
        .catch(() => undefined);
    });
  }
</script>

<div class="flex h-screen w-full overflow-hidden bg-slate-900">
  <!-- Left: Layer Panel -->
  {#if !readonly}
    <div class="w-56 shrink-0 flex flex-col">
      <LayerPanel {mapId} onlayerchange={handleLayerChange} />
    </div>
  {/if}

  <!-- Center: Map + toolbar -->
  <div class="flex-1 relative flex flex-col min-w-0">
    <!-- Top toolbar -->
    <div class="flex items-center gap-2 px-3 py-2 bg-slate-800 border-b border-white/10 shrink-0">
      <span class="text-sm font-medium text-white truncate mr-auto">{mapTitle}</span>

      {#if !readonly}
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

        <Button variant="ghost" size="sm" onclick={() => (showDataTable = !showDataTable)}>
          <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
            <path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm15 2h-4v3h4V4zm0 4h-4v3h4V8zm0 4h-4v3h3a1 1 0 001-1v-2zm-5 3v-3H6v3h4zm-5 0v-3H1v2a1 1 0 001 1h3zm-4-4h4V8H1v3zm0-4h4V4H1v3zm5-3v3h4V4H6zm4 4H6v3h4V8z"/>
          </svg>
          Table
        </Button>

        <Tooltip content="Filter features by attribute value">
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
              <span class="ml-1 rounded-full bg-blue-500 px-1 text-xs font-semibold leading-tight">
                {filterStore.get(layersStore.active.id).length}
              </span>
            {/if}
          </Button>
        </Tooltip>

        <Button variant="ghost" size="sm" onclick={saveViewport} loading={savingViewport}>
          Save View
        </Button>

        <Tooltip content="Comment threads">
          <Button
            variant="ghost"
            size="sm"
            onclick={() => (showComments = !showComments)}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M14 1a1 1 0 011 1v8a1 1 0 01-1 1H4.414A2 2 0 003 11.586l-2 2V2a1 1 0 011-1h12zm-3 3.5a.5.5 0 000-1h-6a.5.5 0 000 1h6zm0 2.5a.5.5 0 000-1h-6a.5.5 0 000 1h6zm0 2.5a.5.5 0 000-1h-3a.5.5 0 000 1h3z"/>
            </svg>
            Comments
          </Button>
        </Tooltip>

        <Tooltip content="Spatial geoprocessing (buffer, clip, intersect…)">
          <Button
            variant="ghost"
            size="sm"
            onclick={() => (showGeoprocessing = !showGeoprocessing)}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.5 7.5a.5.5 0 010 1H5.707l2.147 2.146a.5.5 0 01-.708.708l-3-3a.5.5 0 010-.708l3-3a.5.5 0 11.708.708L5.707 7.5H11.5z"/>
            </svg>
            Geoprocess
          </Button>
        </Tooltip>

        <Tooltip content="Manage collaborators">
          <Button
            variant="ghost"
            size="sm"
            onclick={() => (showCollaborators = !showCollaborators)}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M15 14s1 0 1-1-1-4-5-4-5 3-5 4 1 1 1 1h8zm-7.978-1A.261.261 0 017 12.996c.001-.264.167-1.03.76-1.72C8.312 10.629 9.282 10 11 10c1.717 0 2.687.63 3.24 1.276.593.69.758 1.457.76 1.72l-.008.002-.014.002H7.022zM11 7a2 2 0 100-4 2 2 0 000 4zm3-2a3 3 0 11-6 0 3 3 0 016 0zM6.936 9.28a5.88 5.88 0 00-1.23-.247A7.35 7.35 0 005 9c-4 0-5 3-5 4 0 .667.333 1 1 1h4.216A2.238 2.238 0 015 13c0-1.01.377-2.042 1.09-2.904.243-.294.526-.569.846-.816zM4.92 10A5.493 5.493 0 004 13H1c0-.26.164-1.03.76-1.724.545-.636 1.492-1.256 3.16-1.275zM1.5 5.5a3 3 0 116 0 3 3 0 01-6 0zm3-2a2 2 0 100 4 2 2 0 000-4z"/>
            </svg>
            Collaborators
          </Button>
        </Tooltip>

        <Tooltip content="Map activity log">
          <Button
            variant="ghost"
            size="sm"
            onclick={() => (showActivity = !showActivity)}
          >
            <svg class="h-4 w-4" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm14.5 5.5h-13v1h13v-1zM2 4.5h12v1H2v-1zm0 4h8v1H2v-1z"/>
            </svg>
            Activity
          </Button>
        </Tooltip>
      {/if}
    </div>

    <!-- Map area — bind:this synced to mapStore.mapContainerEl for high-res export -->
    <div class="relative flex-1 min-h-0" bind:this={mapAreaEl}>
      <MapCanvas
        {readonly}
        {layerData}
        onfeaturedrawn={handleFeatureDrawn}
      />

      <!-- Map overlay controls -->
      <div class="absolute bottom-6 left-3 flex gap-2">
        <BasemapPicker />
      </div>

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
  <!-- Rendered via styleStore.editingLayerId -->
  <StylePanel />

  <!-- Comment panel (collapsible, right side) -->
  {#if showComments && !readonly}
    <div class="w-72 shrink-0 overflow-hidden flex flex-col">
      <CommentPanel {mapId} {...(userId !== undefined ? { userId } : {})} />
    </div>
  {/if}

  <!-- Collaborators panel (collapsible, right side) -->
  {#if showCollaborators && !readonly}
    <div class="w-72 shrink-0 overflow-hidden flex flex-col">
      <CollaboratorsPanel {mapId} />
    </div>
  {/if}

  <!-- Geoprocessing panel (collapsible, right side) -->
  {#if showGeoprocessing && !readonly}
    <div class="w-72 shrink-0 overflow-hidden flex flex-col">
      <GeoprocessingPanel
        {mapId}
        layers={layersStore.all}
        onlayercreated={async (layerId) => {
          // Refresh layer list first so the GeoJSONSource is rendered before
          // loadLayerData attempts map.getSource(). Order matters here.
          const newLayers = await trpc.layers.list.query({ mapId });
          layersStore.set(newLayers as unknown as Layer[]);
          await loadLayerData(layerId);
        }}
      />
    </div>
  {/if}

  <!-- Activity feed panel (collapsible, right-most) -->
  {#if showActivity && !readonly}
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
