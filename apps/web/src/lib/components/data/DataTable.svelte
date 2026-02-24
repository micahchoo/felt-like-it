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
</div>
