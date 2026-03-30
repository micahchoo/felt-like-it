<script lang="ts">
  import { mapStore } from '$lib/stores/map.svelte.js';
  import type { GeoJSONFeature, LayerStyle } from '@felt-like-it/shared-types';
  import { computeBbox } from '@felt-like-it/geo-engine';
  import { formatAttributeValue } from '$lib/utils/format.js';

  interface Props {
    features?: GeoJSONFeature[];
    /** Optional layer style — drives attributes displayName and format for column headers and cell values. */
    style?: LayerStyle;

    // Server-side pagination mode
    mode?: 'client' | 'server';
    serverRows?: Array<{ id: string; properties: Record<string, unknown>; geometryType: string }>;
    serverTotal?: number;
    serverPage?: number;
    serverPageSize?: number;
    onPageChange?: (_page: number) => void;
    onPageSizeChange?: (_size: number) => void;
    onSortChange?: (_sortBy: string, _sortDir: 'asc' | 'desc') => void;
    /** Called when a row is clicked — narrows the MapEditorState dependency to a single callback. */
    onSelectFeature?: (_feature: GeoJSONFeature) => void;
  }

  let {
    features = [],
    style,
    mode = 'client',
    serverRows = [],
    serverTotal = 0,
    serverPage = 1,
    serverPageSize = 50,
    onPageChange,
    onPageSizeChange,
    onSortChange,
    onSelectFeature,
  }: Props = $props();
  let sortKey = $state<string | null>(null);
  let sortAsc = $state(true);
  let filterText = $state('');
  let selectedFeatureId = $state<string | number | null>(null);

  // Derive column headers from features (client) or server rows
  const columns = $derived.by(() => {
    const keys = new Set<string>();
    const source = mode === 'server'
      ? serverRows.map((r) => r.properties)
      : features.slice(0, 100).map((f) => f.properties ?? {});
    for (const props of source) {
      for (const k of Object.keys(props ?? {})) {
        if (!k.startsWith('_')) keys.add(k);
      }
    }
    return Array.from(keys).slice(0, 20);
  });

  const filteredFeatures = $derived.by(() => {
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

  // Rows used by the table — switches between client and server data.
  // Server rows have no geometry; cast to GeoJSONFeature for uniform iteration.
  const displayRows = $derived<GeoJSONFeature[]>(
    mode === 'server'
      ? serverRows.map((r) => ({
          type: 'Feature' as const,
          id: r.id,
          geometry: { type: 'Point', coordinates: [0, 0] },
          properties: { ...r.properties, _id: r.id },
        }) as GeoJSONFeature)
      : filteredFeatures
  );

  const totalCount = $derived(mode === 'server' ? serverTotal : features.length);

  function handleRowClick(feature: GeoJSONFeature) {
    selectedFeatureId = feature.id ?? null;
    onSelectFeature?.(feature);
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
    if (mode === 'server') {
      const serverSortable = ['created_at', 'updated_at', 'id'];
      if (serverSortable.includes(key)) {
        const newDir = sortKey === key && sortAsc ? 'desc' : 'asc';
        sortKey = key;
        sortAsc = newDir === 'asc';
        onSortChange?.(key, newDir);
      }
      return;
    }
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

<div class="flex flex-col h-full bg-surface-container text-white">
  {#if totalCount === 0}
    <div class="flex flex-col items-center justify-center py-12 px-4 text-center h-full">
      <svg class="h-6 w-6 text-on-surface-variant/70 mb-2" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M0 2a2 2 0 012-2h12a2 2 0 012 2v12a2 2 0 01-2 2H2a2 2 0 01-2-2V2zm15 2h-4v3h4V4zm0 4h-4v3h4V8zm0 4h-4v3h3a1 1 0 001-1v-2zm-5 3v-3H6v3h4zm-5 0v-3H1v2a1 1 0 001 1h3zm-4-4h4V8H1v3zm0-4h4V4H1v3zm5-3v3h4V4H6zm4 4H6v3h4V8z"/>
      </svg>
      <p class="text-xs text-on-surface-variant">
        {mode === 'server' ? 'No features in current viewport.' : 'Draw features on the map or import data to see them here.'}
      </p>
    </div>
  {:else}
  <!-- Table toolbar -->
  <div class="flex items-center gap-2 px-3 py-2 border-b border-white/5 shrink-0">
    <span class="text-[10px] font-bold text-primary uppercase tracking-widest">
      Feature Attributes
    </span>
    <span class="text-on-surface-variant/50 text-[10px] uppercase tracking-widest">
      {#if mode === 'server'}
        {serverTotal > 0
          ? `${(serverPage - 1) * serverPageSize + 1}–${Math.min(serverPage * serverPageSize, serverTotal)} of ${serverTotal.toLocaleString()} in viewport`
          : 'No features in viewport'}
      {:else}
        {filteredFeatures.length} of {features.length} features
      {/if}
    </span>
    {#if mode === 'client'}
      <input
        type="search"
        bind:value={filterText}
        placeholder="Search…"
        class="ml-auto w-44 rounded bg-surface-low border border-white/5 px-2 py-1 text-xs text-white placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    {/if}
  </div>

  <!-- Table -->
  <div class="flex-1 overflow-auto scrollbar-thin">
    <table class="w-full text-xs border-collapse">
      <thead class="sticky top-0 bg-surface-low z-10">
        <tr>
          {#each columns as col (col)}
            <th
              class="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-on-surface-variant border-b border-white/5 whitespace-nowrap cursor-pointer hover:text-white select-none"
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
        {#each displayRows as feature (feature.id)}
          <tr
            class="border-b border-white/5 cursor-pointer transition-colors
                   {selectedFeatureId === feature.id
                     ? 'bg-primary/10 border-l-2 border-primary'
                     : 'bg-surface-container hover:bg-surface-high'}"
            onclick={() => handleRowClick(feature)}
            onkeydown={(e) => e.key === 'Enter' && handleRowClick(feature)}
            tabindex="0"
          >
            {#each columns as col (col)}
              <td
                class="px-3 py-1.5 max-w-40 truncate whitespace-nowrap
                       {col === 'id' || col === '_id'
                         ? 'font-mono text-on-surface-variant/70'
                         : col === 'geometry_type' || col === 'type'
                           ? 'text-xs text-on-surface'
                           : 'text-xs text-on-surface'}"
              >
                {#if col === 'status' || col === 'validation'}
                  {@const val = String(feature.properties?.[col] ?? '')}
                  {#if val.toLowerCase() === 'validated'}
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-emerald-400 bg-emerald-400/10">{val}</span>
                  {:else if val.toLowerCase() === 'overlap'}
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-amber-400 bg-amber-400/10">{val}</span>
                  {:else if val.toLowerCase() === 'draft'}
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium text-on-surface-variant/70 bg-surface-high">{val}</span>
                  {:else}
                    {formatCell(col, feature.properties?.[col])}
                  {/if}
                {:else}
                  {formatCell(col, feature.properties?.[col])}
                {/if}
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>

    {#if displayRows.length === 0}
      <p class="text-center text-on-surface-variant py-8 text-xs">
        {mode === 'server' ? 'No features to display in current viewport.' : filterText ? 'No features match your filter.' : 'No features to display. Draw on the map or import data.'}
      </p>
    {/if}
  </div>

  <!-- Footer -->
  <div class="flex items-center justify-between px-3 py-2 border-t border-white/5 text-xs text-on-surface-variant shrink-0">
    <span class="text-[10px] text-on-surface-variant/70">
      {#if mode === 'server'}
        Showing {serverTotal > 0 ? `${(serverPage - 1) * serverPageSize + 1}–${Math.min(serverPage * serverPageSize, serverTotal)}` : '0'} of {serverTotal.toLocaleString()} features
      {:else}
        Showing {filteredFeatures.length} of {features.length} features
      {/if}
    </span>
    {#if mode === 'server'}
      <div class="flex items-center gap-2">
        <select
          class="bg-surface-low border border-white/5 rounded px-1 py-0.5 text-xs text-on-surface"
          value={serverPageSize}
          onchange={(e) => onPageSizeChange?.(Number((e.target as HTMLSelectElement).value))}
        >
          <option value={25}>25 / page</option>
          <option value={50}>50 / page</option>
          <option value={100}>100 / page</option>
        </select>
        <button
          class="px-2 py-0.5 rounded bg-surface-low hover:bg-surface-high transition-colors disabled:opacity-40"
          disabled={serverPage <= 1}
          onclick={() => onPageChange?.(serverPage - 1)}
        >Prev</button>
        <span class="text-on-surface-variant/70">{serverPage} / {Math.max(1, Math.ceil(serverTotal / serverPageSize))}</span>
        <button
          class="px-2 py-0.5 rounded bg-surface-low hover:bg-surface-high transition-colors disabled:opacity-40"
          disabled={serverPage * serverPageSize >= serverTotal}
          onclick={() => onPageChange?.(serverPage + 1)}
        >Next</button>
      </div>
    {/if}
  </div>
  {/if}
</div>
