<script lang="ts">
  import { toPng } from 'html-to-image';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import type { Layer } from '@felt-like-it/shared-types';

  interface Props {
    layers: Layer[];
    open: boolean;
  }

  let { layers, open = $bindable() }: Props = $props();

  let selectedLayerId = $state('');
  $effect(() => {
    if (!selectedLayerId && layers[0]) selectedLayerId = layers[0].id;
  });

  let exportingGeoJSON = $state(false);
  let exportingGpkg = $state(false);
  let exportingShp = $state(false);
  let exportingPdf = $state(false);
  let exportingPNG = $state(false);

  /** Fetch a layer export and trigger a browser download. */
  async function downloadLayer(format: string, extension: string): Promise<void> {
    const layer = layers.find((l) => l.id === selectedLayerId);
    const filename = `${layer?.name ?? 'layer'}.${extension}`;

    const res = await fetch(`/api/export/${selectedLayerId}?format=${format}`);
    if (!res.ok) throw new Error('Export failed');

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Delay revocation to ensure browser has time to start the download
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function exportGeoJSON(): Promise<void> {
    if (!selectedLayerId) return;
    exportingGeoJSON = true;
    try {
      await downloadLayer('geojson', 'geojson');
      toastStore.success('GeoJSON exported.');
    } catch {
      toastStore.error('Failed to export GeoJSON.');
    } finally {
      exportingGeoJSON = false;
    }
  }

  async function exportGpkg(): Promise<void> {
    if (!selectedLayerId) return;
    exportingGpkg = true;
    try {
      await downloadLayer('gpkg', 'gpkg');
      toastStore.success('GeoPackage exported.');
    } catch {
      toastStore.error('Failed to export GeoPackage.');
    } finally {
      exportingGpkg = false;
    }
  }

  async function exportShp(): Promise<void> {
    if (!selectedLayerId) return;
    exportingShp = true;
    try {
      await downloadLayer('shp', 'shp.zip');
      toastStore.success('Shapefile exported.');
    } catch {
      toastStore.error('Failed to export Shapefile.');
    } finally {
      exportingShp = false;
    }
  }

  async function exportPdf(): Promise<void> {
    if (!selectedLayerId) return;
    exportingPdf = true;
    try {
      const container = mapStore.mapContainerEl;
      let screenshot: string | undefined;
      if (container) {
        try {
          screenshot = await toPng(container, { pixelRatio: 2 });
        } catch {
          // Best effort — PDF will be generated without map image
        }
      }

      const layer = layers.find((l) => l.id === selectedLayerId);
      const title = layer?.name ?? 'Map Export';
      const filename = `${layer?.name ?? 'export'}.pdf`;

      const res = await fetch(`/api/export/${selectedLayerId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          ...(screenshot !== undefined ? { screenshot } : {}),
        }),
      });
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      // Delay revocation to ensure browser has time to start the download
      setTimeout(() => URL.revokeObjectURL(url), 60_000);

      toastStore.success('PDF exported.');
    } catch {
      toastStore.error('Failed to export PDF.');
    } finally {
      exportingPdf = false;
    }
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
</script>

<Modal bind:open title="Export & Output Controls">
  <div class="flex flex-col gap-5 bg-surface-container rounded-xl">
    <!-- Header label -->
    <div class="flex items-center justify-between">
      <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Export & Output Controls</span>
      <span class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">PROJECT ALPHA / WORKSPACE XX-2</span>
    </div>

    <!-- Active layers list -->
    <div class="space-y-2">
      <h3 class="text-[10px] font-bold text-primary uppercase tracking-widest">Active Layers</h3>
      <div class="flex flex-col gap-1">
        {#each layers as layer (layer.id)}
          <label class="flex items-center gap-2 rounded-lg border border-white/5 bg-surface-container-low px-3 py-2 cursor-pointer hover:bg-white/5 transition-colors">
            <input
              type="radio"
              name="selectedLayer"
              value={layer.id}
              bind:group={selectedLayerId}
              class="accent-primary"
            />
            <span class="flex-1 text-xs font-semibold text-on-surface">{layer.name}</span>
            <span class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-primary/10 text-primary">
              {layer.type ?? 'vector'}
            </span>
          </label>
        {/each}
      </div>
    </div>

    <div class="border-t border-white/5"></div>

    <!-- Output format selector -->
    <div class="space-y-2">
      <h3 class="text-[10px] font-bold text-primary uppercase tracking-widest">Output Format</h3>
      <div class="flex flex-col gap-2">
        <!-- GeoJSON -->
        <button
          type="button"
          onclick={exportGeoJSON}
          disabled={!selectedLayerId || exportingGeoJSON}
          class="flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors
            {exportingGeoJSON
              ? 'border-primary/20 bg-amber-500/10 cursor-wait opacity-75'
              : 'border-primary/20 bg-amber-500/10 hover:bg-amber-500/15'}"
        >
          <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-primary">
            <span class="h-2 w-2 rounded-full bg-primary"></span>
          </span>
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold text-on-surface">GeoJSON</span>
            <p class="text-xs text-on-surface-variant">Layer features as .geojson</p>
          </div>
          {#if exportingGeoJSON}
            <span class="text-[9px] font-bold uppercase tracking-wider text-primary">Exporting…</span>
          {/if}
        </button>

        <!-- GeoPackage -->
        <button
          type="button"
          onclick={exportGpkg}
          disabled={!selectedLayerId || exportingGpkg}
          class="flex items-start gap-3 rounded-lg border border-white/5 bg-surface-container-low px-3 py-2.5 text-left transition-colors hover:bg-white/5
            {exportingGpkg ? 'cursor-wait opacity-75' : ''}"
        >
          <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-white/20">
          </span>
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold text-on-surface">GeoPackage</span>
            <p class="text-xs text-on-surface-variant">Layer features as .gpkg</p>
          </div>
          {#if exportingGpkg}
            <span class="text-[9px] font-bold uppercase tracking-wider text-primary">Exporting…</span>
          {/if}
        </button>

        <!-- ESRI Shapefile -->
        <button
          type="button"
          onclick={exportShp}
          disabled={!selectedLayerId || exportingShp}
          class="flex items-start gap-3 rounded-lg border border-white/5 bg-surface-container-low px-3 py-2.5 text-left transition-colors hover:bg-white/5
            {exportingShp ? 'cursor-wait opacity-75' : ''}"
        >
          <span class="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 border-white/20">
          </span>
          <div class="flex-1 min-w-0">
            <span class="text-xs font-semibold text-on-surface">ESRI Shapefile</span>
            <p class="text-xs text-on-surface-variant">Layer features as .shp</p>
          </div>
          {#if exportingShp}
            <span class="text-[9px] font-bold uppercase tracking-wider text-primary">Exporting…</span>
          {/if}
        </button>
      </div>
    </div>

    <!-- Progress bar (visible when any export is running) -->
    {#if exportingGeoJSON || exportingGpkg || exportingShp || exportingPdf || exportingPNG}
      <div class="space-y-1.5">
        <div class="flex items-center justify-between">
          <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Processing</span>
          <span class="text-xs text-on-surface-variant">Preparing file…</span>
        </div>
        <div class="h-1.5 w-full rounded-full bg-surface-container-low">
          <div class="h-1.5 w-2/3 rounded-full bg-primary animate-pulse"></div>
        </div>
        <div class="flex items-center justify-between text-xs text-on-surface-variant">
          <span>Processing…</span>
          <span>-- KB</span>
        </div>
      </div>
    {/if}

    <div class="border-t border-white/5"></div>

    <!-- High-res PNG export + PDF -->
    <div class="space-y-2">
      <h3 class="text-[10px] font-bold text-primary uppercase tracking-widest">Additional Formats</h3>
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          onclick={exportPdf}
          disabled={!selectedLayerId || exportingPdf}
          class="flex flex-col items-start gap-0.5 rounded-xl border border-white/5 px-3 py-2 text-left transition-colors
            {exportingPdf ? 'cursor-wait opacity-75' : 'hover:bg-white/5'}"
        >
          <span class="text-xs font-semibold text-on-surface">{exportingPdf ? 'Exporting…' : 'PDF'}</span>
          <span class="text-[10px] text-on-surface-variant">Map screenshot as .pdf</span>
        </button>
        <button
          type="button"
          onclick={exportPNG}
          disabled={exportingPNG}
          class="flex flex-col items-start gap-0.5 rounded-xl border border-white/5 px-3 py-2 text-left transition-colors
            {exportingPNG ? 'cursor-wait opacity-75' : 'hover:bg-white/5'}"
        >
          <span class="text-xs font-semibold text-on-surface">{exportingPNG ? 'Exporting…' : 'PNG (2x)'}</span>
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
        disabled={!selectedLayerId || exportingGeoJSON}
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
