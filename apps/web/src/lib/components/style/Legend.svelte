<script lang="ts">
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { styleStore } from '$lib/stores/style.svelte.js';
  import type { LayerStyle, LegendEntry } from '@felt-like-it/shared-types';

  // Build legend entries from all visible layers
  const legendItems = $derived(() => {
    const items: Array<{ layerId: string; layerName: string; entries: LegendEntry[]; color: string }> = [];

    for (const layer of layersStore.all) {
      if (!layer.visible) continue;

      const style = layer.style as LayerStyle;
      const paint = (style.paint ?? {}) as Record<string, unknown>;

      if (style.legend && style.legend.length > 0) {
        items.push({ layerId: layer.id, layerName: layer.name, entries: style.legend, color: '' });
      } else {
        // Simple style — single color
        const colorKey = layer.type === 'line'
          ? 'line-color'
          : layer.type === 'polygon'
          ? 'fill-color'
          : 'circle-color';
        const color = typeof paint[colorKey] === 'string' ? paint[colorKey] as string : '#888';
        items.push({ layerId: layer.id, layerName: layer.name, entries: [], color });
      }
    }

    return items;
  });
</script>

{#if styleStore.showLegend && legendItems().length > 0}
  <div
    class="absolute bottom-14 right-3 z-10 bg-slate-800/90 backdrop-blur-sm rounded-lg shadow-xl ring-1 ring-white/10 p-3 max-w-48"
    aria-label="Map legend"
  >
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs font-semibold text-white">Legend</span>
      <button
        onclick={() => styleStore.toggleLegend()}
        class="text-slate-400 hover:text-white transition-colors"
        aria-label="Hide legend"
      >
        <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
        </svg>
      </button>
    </div>

    <div class="space-y-3">
      {#each legendItems() as item (item.layerId)}
        <div>
          <p class="text-xs text-slate-400 font-medium truncate mb-1">{item.layerName}</p>

          {#if item.entries.length > 0}
            {#each item.entries as entry, i (i)}
              <div class="flex items-center gap-2 py-0.5">
                <span
                  class="w-3 h-3 rounded-sm shrink-0"
                  style="background-color: {entry.color}"
                ></span>
                <span class="text-xs text-slate-300 truncate">{entry.label}</span>
              </div>
            {/each}
          {:else}
            <div class="flex items-center gap-2">
              <span
                class="w-3 h-3 rounded-sm shrink-0"
                style="background-color: {item.color}"
              ></span>
              <span class="text-xs text-slate-300">{item.layerName}</span>
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>
{:else if !styleStore.showLegend}
  <button
    onclick={() => styleStore.toggleLegend()}
    class="absolute bottom-14 right-3 z-10 bg-slate-800/90 backdrop-blur-sm rounded-lg px-2 py-1 text-xs text-slate-300 hover:text-white shadow-md ring-1 ring-white/10 transition-colors"
    aria-label="Show legend"
  >
    Legend
  </button>
{/if}
