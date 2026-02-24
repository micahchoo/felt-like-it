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

  // Use $derived so the initial selection is reactive to prop changes
  let selectedLayerId = $state('');
  $effect(() => {
    if (!selectedLayerId && layers[0]) selectedLayerId = layers[0].id;
  });
  let exportingGeoJSON = $state(false);
  let exportingPNG = $state(false);

  async function exportGeoJSON() {
    if (!selectedLayerId) return;
    exportingGeoJSON = true;

    try {
      const res = await fetch(`/api/export/${selectedLayerId}`);
      if (!res.ok) throw new Error('Export failed');

      const blob = await res.blob();
      const layer = layers.find((l) => l.id === selectedLayerId);
      const filename = `${layer?.name ?? 'layer'}.geojson`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);

      toastStore.success(`Exported ${filename}`);
    } catch {
      toastStore.error('Failed to export GeoJSON.');
    } finally {
      exportingGeoJSON = false;
    }
  }

  /**
   * Export the visible map area (canvas + legend overlay) as a 2× resolution PNG.
   * Uses html-to-image which respects the DOM tree — so the Legend and any other
   * overlays inside mapContainerEl are included automatically.
   * Requires MapLibre's preserveDrawingBuffer: true (set in MapCanvas.svelte).
   */
  async function exportPNG() {
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
    <!-- GeoJSON export -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-white">Export layer as GeoJSON</h3>
      <select
        bind:value={selectedLayerId}
        class="w-full rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-label="Select layer to export"
      >
        {#each layers as layer (layer.id)}
          <option value={layer.id}>{layer.name}</option>
        {/each}
      </select>
      <Button
        variant="primary"
        onclick={exportGeoJSON}
        loading={exportingGeoJSON}
        disabled={!selectedLayerId}
        class="w-full"
      >
        Download GeoJSON
      </Button>
    </div>

    <div class="border-t border-white/10"></div>

    <!-- High-res PNG export -->
    <div class="space-y-2">
      <h3 class="text-sm font-medium text-white">Export as PNG</h3>
      <p class="text-xs text-slate-400">
        Captures the map view and legend at 2× resolution (high-DPI / print-ready).
      </p>
      <Button
        variant="secondary"
        onclick={exportPNG}
        loading={exportingPNG}
        class="w-full"
      >
        Save as PNG (2×)
      </Button>
    </div>
  </div>
</Modal>
