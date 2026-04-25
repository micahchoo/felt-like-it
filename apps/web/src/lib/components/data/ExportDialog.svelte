<script lang="ts">
  import { toPng } from 'html-to-image';
  import { untrack } from 'svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import { getMapStore } from '$lib/stores/map.svelte.js';
  const mapStore = getMapStore();
  import { createExportStore, type ExportFormat } from '$lib/stores/export-store.svelte.js';
  import type { Layer } from '@felt-like-it/shared-types';

  interface Props {
    layers: Layer[];
    mapId: string;
    open: boolean;
  }

  let { layers, mapId, open = $bindable() }: Props = $props();

  let selectedLayerId = $state('');
  // untrack(layers) so this effect only re-fires when selectedLayerId changes —
  // prevents reactive layer-list updates from re-seeding (or fighting) user selection.
  $effect(() => {
    if (!selectedLayerId) {
      const first = untrack(() => layers[0]?.id);
      if (first) selectedLayerId = first;
    }
  });

  // Unified export store replaces 6 individual boolean states
  const exportStore = createExportStore();

  // PNG export stays separate (client-side via html-to-image)
  let exportingPNG = $state(false);
  // Annotations export stays separate (different endpoint)
  let exportingAnnotations = $state(false);

  /** Wait for map tiles to finish loading before capture (max 10s). */
  function waitForTiles(): Promise<void> {
    const map = mapStore.mapInstance;
    if (!map || map.areTilesLoaded()) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 10_000);
      map.once('idle', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  /**
   * Subscribe to SSE for async export progress.
   * Returns a cleanup function to close the connection.
   */
  function subscribeToProgress(jobId: string): () => void {
    const eventSource = new EventSource(`/api/v1/export/progress?jobId=${jobId}`);

    eventSource.addEventListener('progress', (event) => {
      const data = JSON.parse(event.data);
      exportStore.setProgress(data.progress);

      if (data.status === 'processing' && exportStore.isPending) {
        exportStore.processing();
      }

      if (data.status === 'done') {
        exportStore.complete();
        toastStore.success(`${exportStore.getFormatLabel()} export complete.`);
        eventSource.close();
      }

      if (data.status === 'failed') {
        exportStore.fail(data.error || 'Export failed');
        toastStore.error(`Export failed: ${data.error || 'Unknown error'}`);
        eventSource.close();
      }
    });

    eventSource.addEventListener('error', (event) => {
      const data = JSON.parse((event as MessageEvent).data || '{}');
      exportStore.fail(data.error || 'Connection error');
      toastStore.error('Export connection error');
      eventSource.close();
    });

    return () => eventSource.close();
  }

  /**
   * Unified export handler using POST /api/export with SSE progress tracking.
   * For simple exports (single layer, no annotations), may return immediately.
   * For async exports (PDF, multi-layer), subscribes to SSE progress.
   */
  async function handleExport(format: ExportFormat): Promise<void> {
    if (!selectedLayerId) return;

    exportStore.start(format);

    try {
      const layer = layers.find((l) => l.id === selectedLayerId);
      const title = layer?.name ?? 'Map Export';

      // Capture screenshot for PDF exports
      let screenshot: string | undefined;
      if (format === 'pdf') {
        const container = mapStore.mapContainerEl;
        if (container) {
          try {
            await waitForTiles();
            screenshot = await toPng(container, { pixelRatio: 2 });
          } catch {
            // Best effort — PDF will be generated without map image
          }
        }
      }

      const response = await fetch('/api/v1/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layerId: selectedLayerId,
          format,
          title,
          ...(screenshot !== undefined ? { screenshot } : {}),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Export failed' }));
        throw new Error(errorData.error || 'Export failed');
      }

      // Check if this is an async export (202 Accepted) or immediate (200 OK)
      if (response.status === 202) {
        // Async export - subscribe to SSE progress
        const { jobId } = await response.json();
        subscribeToProgress(jobId);
      } else {
        // Immediate export - trigger download
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const extension = format === 'shp' ? 'shp.zip' : format === 'gpkg' ? 'gpkg' : format;
        const filename = `${layer?.name ?? 'export'}.${extension}`;
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);

        exportStore.complete();
        toastStore.success(`${exportStore.getFormatLabel()} exported.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Export failed';
      exportStore.fail(message);
      toastStore.error(`Failed to export ${exportStore.getFormatLabel()}: ${message}`);
    }
  }

  // Convenience wrappers for each format
  async function exportGeoJSON(): Promise<void> {
    await handleExport('geojson');
  }

  async function exportGpkg(): Promise<void> {
    await handleExport('gpkg');
  }

  async function exportShp(): Promise<void> {
    await handleExport('shp');
  }

  async function exportPdf(): Promise<void> {
    await handleExport('pdf');
  }

  /**
   * Export the visible map area (canvas + legend overlay) as a 2x resolution PNG.
   * Uses html-to-image which respects the DOM tree — so the Legend and any other
   * overlays inside mapContainerEl are included automatically.
   * Requires MapLibre's preserveDrawingBuffer: true (set in MapCanvas.svelte).
   */
  async function exportPNG(): Promise<void> {
    exportingPNG = true;
    try {
      const container = mapStore.mapContainerEl;
      if (!container) throw new Error('Map container not ready');

      toastStore.info('Waiting for tiles to load…');
      await waitForTiles();

      const dataUrl = await toPng(container, { pixelRatio: 2 });

      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'map-export.png';
      a.click();

      toastStore.success('High-res map image saved.');
    } catch {
      toastStore.error('Failed to export map image.');
    } finally {
      exportingPNG = false;
    }
  }

  async function exportAnnotations(): Promise<void> {
    if (!mapId) return;
    exportingAnnotations = true;
    try {
      const res = await fetch(`/api/v1/export/annotations/${mapId}`);
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'annotations.geojson';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

      toastStore.success('Annotations exported as GeoJSON.');
    } catch {
      toastStore.error('Failed to export annotations.');
    } finally {
      exportingAnnotations = false;
    }
  }
</script>

<Modal bind:open title="Export & Output Controls">
  <div class="flex flex-col gap-5 bg-surface-container rounded-xl">
    <!-- Header label -->
    <div class="flex items-center justify-between">
      <span class="text-[10px] font-bold text-primary uppercase tracking-widest"
        >Export & Output Controls</span
      >
      <span class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest"
        >PROJECT ALPHA / WORKSPACE XX-2</span
      >
    </div>

    <!-- Active layers list -->
    <div class="space-y-2">
      <h3 class="text-[10px] font-bold text-primary uppercase tracking-widest">Active Layers</h3>
      <div class="flex flex-col gap-1">
        {#each layers as layer (layer.id)}
          <label
            class="flex items-center gap-2 rounded-lg border border-white/5 bg-surface-low px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors"
          >
            <input
              type="radio"
              name="selectedLayer"
              value={layer.id}
              bind:group={selectedLayerId}
              class="accent-primary"
            />
            <span class="flex-1 text-xs font-semibold text-on-surface">{layer.name}</span>
            <span
              class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary"
            >
              {layer.type ?? 'vector'}
            </span>
          </label>
        {/each}
      </div>
    </div>

    <div class="border-t border-white/5"></div>

    <!-- Output format selector -->
    <div class="space-y-2">
      <h3 class="text-[10px] font-bold text-primary uppercase tracking-widest">Data Export</h3>
      <div class="flex flex-col gap-2">
        <!-- GeoJSON -->
        <button
          type="button"
          onclick={exportGeoJSON}
          disabled={!selectedLayerId ||
            (exportStore.isActive && exportStore.state.format === 'geojson')}
          class="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors
            {exportStore.isActive && exportStore.state.format === 'geojson'
            ? 'border-primary/20 bg-amber-500/10 cursor-wait opacity-75'
            : 'border-primary/20 bg-amber-500/10 hover:bg-amber-500/15'}"
        >
          <span
            class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary"
          >
            <span class="h-2 w-2 rounded-full bg-primary"></span>
          </span>
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold text-on-surface">GeoJSON (layer data)</span>
            <p class="text-xs text-on-surface-variant">Layer features as .geojson</p>
          </div>
          {#if exportStore.isActive && exportStore.state.format === 'geojson'}
            <span class="text-[9px] font-bold uppercase tracking-wider text-primary"
              >{exportStore.isProcessing ? `${exportStore.state.progress}%` : 'Exporting…'}</span
            >
          {/if}
        </button>

        <!-- GeoPackage -->
        <button
          type="button"
          onclick={exportGpkg}
          disabled={!selectedLayerId ||
            (exportStore.isActive && exportStore.state.format === 'gpkg')}
          class="flex items-start gap-3 rounded-lg border border-white/5 bg-surface-low px-3 py-2.5 text-left transition-colors hover:bg-white/5
            {exportStore.isActive && exportStore.state.format === 'gpkg'
            ? 'cursor-wait opacity-75'
            : ''}"
        >
          <span
            class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-white/20"
          >
          </span>
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold text-on-surface">GeoPackage (layer data)</span>
            <p class="text-xs text-on-surface-variant">Layer features as .gpkg</p>
          </div>
          {#if exportStore.isActive && exportStore.state.format === 'gpkg'}
            <span class="text-[9px] font-bold uppercase tracking-wider text-primary"
              >{exportStore.isProcessing ? `${exportStore.state.progress}%` : 'Exporting…'}</span
            >
          {/if}
        </button>

        <!-- ESRI Shapefile -->
        <button
          type="button"
          onclick={exportShp}
          disabled={!selectedLayerId ||
            (exportStore.isActive && exportStore.state.format === 'shp')}
          class="flex items-start gap-3 rounded-lg border border-white/5 bg-surface-low px-3 py-2.5 text-left transition-colors hover:bg-white/5
            {exportStore.isActive && exportStore.state.format === 'shp'
            ? 'cursor-wait opacity-75'
            : ''}"
        >
          <span
            class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-white/20"
          >
          </span>
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold text-on-surface">Shapefile (layer data)</span>
            <p class="text-xs text-on-surface-variant">Layer features as .shp.zip</p>
          </div>
          {#if exportStore.isActive && exportStore.state.format === 'shp'}
            <span class="text-[9px] font-bold uppercase tracking-wider text-primary"
              >{exportStore.isProcessing ? `${exportStore.state.progress}%` : 'Exporting…'}</span
            >
          {/if}
        </button>

        <!-- Annotations GeoJSON -->
        <button
          type="button"
          onclick={exportAnnotations}
          disabled={!mapId || exportingAnnotations}
          class="flex items-start gap-3 rounded-lg border border-white/5 bg-surface-low px-3 py-2.5 text-left transition-colors hover:bg-white/5
            {exportingAnnotations ? 'cursor-wait opacity-75' : ''}"
        >
          <span
            class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-white/20"
          >
          </span>
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold text-on-surface">GeoJSON (annotations)</span>
            <p class="text-xs text-on-surface-variant">Map annotations as .geojson</p>
          </div>
          {#if exportingAnnotations}
            <span class="text-[9px] font-bold uppercase tracking-wider text-primary"
              >Exporting…</span
            >
          {/if}
        </button>
      </div>
    </div>

    <!-- Progress bar (visible when any export is running) -->
    {#if exportStore.isActive || exportingPNG || exportingAnnotations}
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Exporting</span
          >
          <span class="text-xs text-on-surface-variant">
            {exportStore.isProcessing ? `${exportStore.state.progress}%` : 'Preparing file…'}
          </span>
        </div>
        <div class="h-1.5 w-full rounded-full bg-surface-low">
          <div
            class="h-1.5 rounded-full bg-primary transition-all duration-300"
            style:width="{exportStore.isActive ? exportStore.state.progress : 66}%"
          ></div>
        </div>
        <div class="flex items-center justify-between text-xs text-on-surface-variant">
          <span>
            {exportStore.state.format
              ? `Exporting ${exportStore.getFormatLabel()}…`
              : 'Preparing your file…'}
          </span>
          <span>{exportStore.isProcessing ? `${exportStore.state.progress}%` : '--'}</span>
        </div>
      </div>
    {/if}

    <div class="border-t border-white/5"></div>

    <!-- High-res PNG export + PDF -->
    <div class="space-y-2">
      <h3 class="text-[10px] font-bold text-primary uppercase tracking-widest">Map Screenshot</h3>
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          onclick={exportPdf}
          disabled={!selectedLayerId ||
            (exportStore.isActive && exportStore.state.format === 'pdf')}
          class="flex flex-col items-start gap-0.5 rounded-xl border border-white/5 px-3 py-2 text-left transition-colors
            {exportStore.isActive && exportStore.state.format === 'pdf'
            ? 'cursor-wait opacity-75'
            : 'hover:bg-white/5'}"
        >
          <span class="text-xs font-semibold text-on-surface"
            >{exportStore.isActive && exportStore.state.format === 'pdf'
              ? exportStore.isProcessing
                ? `${exportStore.state.progress}%`
                : 'Exporting…'
              : 'PDF'}</span
          >
          <span class="text-[10px] text-on-surface-variant">Map screenshot as .pdf</span>
        </button>
        <button
          type="button"
          onclick={exportPNG}
          disabled={exportingPNG}
          class="flex flex-col items-start gap-0.5 rounded-xl border border-white/5 px-3 py-2 text-left transition-colors
            {exportingPNG ? 'cursor-wait opacity-75' : 'hover:bg-white/5'}"
        >
          <span class="text-xs font-semibold text-on-surface"
            >{exportingPNG ? 'Exporting…' : 'PNG (2x)'}</span
          >
          <span class="text-[10px] text-on-surface-variant">Map screenshot as .png</span>
        </button>
      </div>
    </div>

    <!-- Action buttons -->
    <div class="flex items-center gap-2 pt-1">
      <button
        type="button"
        onclick={() => (open = false)}
        class="flex-1 rounded-xl px-4 py-2 text-xs font-bold text-on-surface-variant hover:text-on-surface transition-colors"
      >
        Cancel Job
      </button>
      <button
        type="button"
        onclick={exportGeoJSON}
        disabled={!selectedLayerId || exportStore.isActive}
        class="flex-1 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-on-primary transition-opacity disabled:opacity-50"
      >
        Download
      </button>
      <button
        type="button"
        class="flex-1 rounded-xl border border-white/5 px-4 py-2 text-xs font-bold text-on-surface-variant hover:text-on-surface transition-colors"
      >
        Generate New Link
      </button>
    </div>
  </div>
</Modal>
