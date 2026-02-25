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
    URL.revokeObjectURL(url);
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
      URL.revokeObjectURL(url);

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

<Modal bind:open title="Export">
  <div class="flex flex-col gap-5">
    <!-- Layer data export -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-white">Export layer data</h3>
      <select
        bind:value={selectedLayerId}
        class="w-full rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Select layer to export"
      >
        {#each layers as layer (layer.id)}
          <option value={layer.id}>{layer.name}</option>
        {/each}
      </select>
      <div class="grid grid-cols-2 gap-2">
        <Button
          variant="primary"
          onclick={exportGeoJSON}
          loading={exportingGeoJSON}
          disabled={!selectedLayerId}
          class="w-full"
        >
          GeoJSON
        </Button>
        <Button
          variant="primary"
          onclick={exportGpkg}
          loading={exportingGpkg}
          disabled={!selectedLayerId}
          class="w-full"
        >
          GeoPackage
        </Button>
        <Button
          variant="primary"
          onclick={exportShp}
          loading={exportingShp}
          disabled={!selectedLayerId}
          class="w-full"
        >
          Shapefile
        </Button>
        <Button
          variant="primary"
          onclick={exportPdf}
          loading={exportingPdf}
          disabled={!selectedLayerId}
          class="w-full"
        >
          PDF
        </Button>
      </div>
    </div>

    <div class="border-t border-white/10"></div>

    <!-- High-res PNG export -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-white">Export as PNG</h3>
      <p class="text-xs text-slate-400">
        Captures the map view and legend at 2x resolution (high-DPI / print-ready).
      </p>
      <Button
        variant="secondary"
        onclick={exportPNG}
        loading={exportingPNG}
        class="w-full"
      >
        Save as PNG (2x)
      </Button>
    </div>
  </div>
</Modal>
