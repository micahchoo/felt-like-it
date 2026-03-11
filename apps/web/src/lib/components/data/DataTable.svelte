<script lang="ts">
  import { mapStore } from '$lib/stores/map.svelte.js';
  import { selectionStore } from '$lib/stores/selection.svelte.js';
  import type { GeoJSONFeature, LayerStyle } from '@felt-like-it/shared-types';
  import { computeBbox } from '$lib/utils/geo.js';
  import { formatAttributeValue } from '$lib/utils/format.js';

  interface Props {
    features: GeoJSONFeature[];
    /** Optional layer style — drives attributes displayName and format for column headers and cell values. */
    style?: LayerStyle;
  }

  let { features, style }: Props = $props();

  let sortKey = $state<string | null>(null);
  let sortAsc = $state(true);
  let filterText = $state('');

  // Derive column headers from features
  const columns = $derived(() => {
    const keys = new Set<string>();
    for (const f of features.slice(0, 100)) {
      for (const k of Object.keys(f.properties ?? {})) {
        if (!k.startsWith('_')) keys.add(k);
      }
    }
    return Array.from(keys).slice(0, 20); // max 20 columns
  });

  const filteredFeatures = $derived(() => {
    let result = features;
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      result = result.filter((f) =>
        Object.values(f.properties ?? {}).some((v) =>
          String(v ?? '').toLowerCase().includes(q)
        )
      );
    }
    if (sortKey) {
      const key = sortKey;
      result = [...result].sort((a, b) => {
        const av = a.properties?.[key];
        const bv = b.properties?.[key];
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
        return sortAsc ? cmp : -cmp;
      });
    }
    return result;
  });

  function handleRowClick(feature: GeoJSONFeature) {
    selectionStore.selectFeature(feature);
    // Zoom to feature
    const bbox = computeBbox([feature]);
    if (bbox && mapStore.mapInstance) {
      mapStore.mapInstance.fitBounds(
        [[bbox[0], bbox[1]], [bbox[2], bbox[3]]],
        { padding: 80, maxZoom: 16, duration: 600 }
      );
    }
  }

  function toggleSort(key: string) {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = true;
    }
  }

  /** Return the display name for a column, falling back to the raw key. */
  function getColumnHeader(col: string): string {
    return style?.attributes?.[col]?.displayName ?? col;
  }

  /** Format a cell value using FSL attribute format options. */
  function formatCell(col: string, val: unknown): string {
    return formatAttributeValue(val, style?.attributes?.[col]?.format);
  }
</script>

<div class="flex flex-col h-full bg-slate-900 text-white">
  {#if features.length === 0}
    <div class="flex flex-col items-center justify-center py-12 px-4 text-center h-full">
      <svg class="h-6 w-6 text-slate-500 mb-2" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm15 2h-4v3h4V4zm0 4h-4v3h4V8zm0 4h-4v3h3a1 1 0 001-1v-2zm-5 3v-3H6v3h4zm-5 0v-3H1v2a1 1 0 001 1h3zm-4-4h4V8H1v3zm0-4h4V4H1v3zm5-3v3h4V4H6zm4 4H6v3h4V8z"/>
      </svg>
      <p class="text-sm text-slate-400">Draw features on the map or import data to see them here.</p>
    </div>
  {:else}
  <!-- Table toolbar -->
  <div class="flex items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0">
    <span class="text-xs font-medium text-slate-300">
      {filteredFeatures().length} of {features.length} features
    </span>
    <input
      type="search"
      bind:value={filterText}
      placeholder="Filter features…"
      class="ml-auto w-48 rounded bg-slate-700 border border-slate-600 px-2 py-1 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  </div>

  <!-- Table -->
  <div class="flex-1 overflow-auto scrollbar-thin">
    <table class="w-full text-xs border-collapse">
      <thead class="sticky top-0 bg-slate-800 z-10">
        <tr>
          {#each columns() as col (col)}
            <th
              class="px-3 py-2 text-left text-slate-300 font-medium border-b border-white/10 whitespace-nowrap cursor-pointer hover:text-white select-none"
              onclick={() => toggleSort(col)}
              title={col}
            >
              {getColumnHeader(col)}
              {#if sortKey === col}
                <span class="ml-1 opacity-70">{sortAsc ? '↑' : '↓'}</span>
              {/if}
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each filteredFeatures() as feature (feature.id)}
          <tr
            class="border-b border-white/5 cursor-pointer transition-colors
                   {selectionStore.selectedFeature?.id === feature.id
                     ? 'bg-blue-600/20'
                     : 'hover:bg-slate-800'}"
            onclick={() => handleRowClick(feature)}
            onkeydown={(e) => e.key === 'Enter' && handleRowClick(feature)}
            tabindex="0"
          >
            {#each columns() as col (col)}
              <td class="px-3 py-1.5 text-slate-200 max-w-40 truncate whitespace-nowrap">
                {formatCell(col, feature.properties?.[col])}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>

    {#if filteredFeatures().length === 0}
      <p class="text-center text-slate-400 py-8 text-xs">
        {filterText ? 'No features match your filter.' : 'No features in this layer.'}
      </p>
    {/if}
  </div>
  {/if}
</div>
