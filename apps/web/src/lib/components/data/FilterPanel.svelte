<script lang="ts">
  import { filterStore, FILTER_OPERATOR_LABELS, type FilterOperator, type UIFilter } from '$lib/stores/filters.svelte.js';
  import type { GeoJSONFeature } from '@felt-like-it/shared-types';

  interface Props {
    layerId: string;
    /** Features from which to derive available property columns. */
    features: GeoJSONFeature[];
  }

  let { layerId, features }: Props = $props();

  // Derive available column names from the first 100 features
  const availableFields = $derived(() => {
    const keys = new Set<string>();
    for (const f of features.slice(0, 100)) {
      for (const k of Object.keys(f.properties ?? {})) {
        if (!k.startsWith('_')) keys.add(k);
      }
    }
    return Array.from(keys).sort();
  });

  const OPERATORS: FilterOperator[] = ['eq', 'ne', 'lt', 'gt', 'cn', 'in', 'ni'];

  // Form state for the "add filter" row
  let newField    = $state('');
  let newOperator = $state<FilterOperator>('eq');
  let newValue    = $state('');

  // Keep newField in sync when availableFields changes
  $effect(() => {
    const fields = availableFields();
    if (!newField && fields.length > 0) {
      newField = fields[0] ?? '';
    }
  });

  const activeFilters = $derived(() => filterStore.get(layerId));

  function addFilter() {
    if (!newField || !newValue.trim()) return;
    filterStore.add(layerId, {
      field:    newField,
      operator: newOperator,
      value:    newValue.trim(),
    } satisfies UIFilter);
    newValue = '';
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') addFilter();
  }
</script>

<div class="flex flex-col gap-2 p-3 bg-slate-800 border-b border-white/10 text-xs text-white">
  <div class="flex items-center justify-between">
    <span class="font-medium text-slate-300">Filters</span>
    {#if activeFilters().length > 0}
      <button
        type="button"
        class="text-slate-400 hover:text-white transition-colors"
        onclick={() => filterStore.clear(layerId)}
      >
        Clear all
      </button>
    {/if}
  </div>

  <!-- Active filter chips -->
  {#if activeFilters().length > 0}
    <ul class="flex flex-col gap-1">
      {#each activeFilters() as filter, i (i)}
        <li class="flex items-center gap-2 bg-slate-700 rounded px-2 py-1">
          <span class="font-mono text-blue-300">{filter.field}</span>
          <span class="text-slate-400">{FILTER_OPERATOR_LABELS[filter.operator]}</span>
          <span class="flex-1 truncate text-white">{filter.value}</span>
          <button
            type="button"
            class="text-slate-400 hover:text-red-400 transition-colors shrink-0"
            onclick={() => filterStore.remove(layerId, i)}
            aria-label="Remove filter"
          >
            ×
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Add filter row -->
  {#if availableFields().length > 0}
    <div class="flex items-center gap-1">
      <!-- Field selector -->
      <select
        bind:value={newField}
        class="flex-1 min-w-0 rounded bg-slate-700 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {#each availableFields() as field (field)}
          <option value={field}>{field}</option>
        {/each}
      </select>

      <!-- Operator selector -->
      <select
        bind:value={newOperator}
        class="w-24 rounded bg-slate-700 border border-slate-600 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {#each OPERATORS as op (op)}
          <option value={op}>{FILTER_OPERATOR_LABELS[op]}</option>
        {/each}
      </select>

      <!-- Value input -->
      <input
        type="text"
        bind:value={newValue}
        onkeydown={handleKeydown}
        placeholder="value"
        class="w-28 rounded bg-slate-700 border border-slate-600 px-2 py-1 text-xs text-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />

      <button
        type="button"
        class="rounded bg-blue-600 hover:bg-blue-500 px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        onclick={addFilter}
        disabled={!newField || !newValue.trim()}
      >
        Add
      </button>
    </div>
  {:else}
    <p class="text-slate-400 italic">Load layer data to add filters.</p>
  {/if}
</div>
