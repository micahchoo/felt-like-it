<script lang="ts">
  import {
    FILTER_OPERATOR_LABELS,
    type FilterOperator,
    type UIFilter,
  } from '$lib/stores/filters.svelte.js';
  import type { FiltersStore } from '$lib/stores/filters-store.svelte.js';
  import type { GeoJSONFeature } from '@felt-like-it/shared-types';

  interface Props {
    store: FiltersStore;
    layerId: string;
    /** Features from which to derive available property columns. */
    features: GeoJSONFeature[];
  }

  let { store, layerId: _layerId, features }: Props = $props();

  // Derive available column names from the first 100 features
  const availableFields = $derived.by(() => {
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
  let newField = $state('');
  let newOperator = $state<FilterOperator>('eq');
  let newValue = $state('');

  // Keep newField in sync when availableFields changes
  $effect(() => {
    const fields = availableFields;
    if (!newField && fields.length > 0) {
      newField = fields[0] ?? '';
    }
  });

  const activeFilters = $derived(store.conditions);

  let addingFilter = $state(false);

  function addFilter() {
    if (!newField || !newValue.trim() || addingFilter) return;
    addingFilter = true;
    store.addCondition({
      field: newField,
      operator: newOperator,
      value: newValue.trim(),
    } satisfies UIFilter);
    newValue = '';
    newField = availableFields[0] ?? '';
    addingFilter = false;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') addFilter();
  }
</script>

<div
  class="flex flex-col gap-2 p-3 bg-surface-container border-b border-white/5 text-xs text-white"
>
  <div class="flex items-center justify-between">
    <div class="flex items-center gap-2">
      <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Filters</span>
      {#if activeFilters.length > 0}
        <span class="bg-primary/20 text-primary text-[9px] font-bold rounded-full px-1.5 py-0.5"
          >{activeFilters.length} active</span
        >
      {/if}
    </div>
    {#if activeFilters.length > 0}
      <button
        type="button"
        class="text-[10px] text-on-surface-variant hover:text-on-surface transition-colors"
        onclick={() => store.clearAll()}
      >
        Clear all
      </button>
    {/if}
  </div>

  {#if activeFilters.length === 0}
    <p class="text-xs text-on-surface-variant text-center py-3 px-4">
      Add filters to show only features matching specific attribute values.
    </p>
  {/if}

  <!-- Active filter chips -->
  {#if activeFilters.length > 0}
    <ul class="flex flex-col gap-1">
      {#each activeFilters as filter, i (i)}
        <li class="flex items-center gap-2 bg-surface-low border border-white/5 rounded px-2 py-1">
          <span class="font-mono text-primary/80">{filter.field}</span>
          <span class="text-on-surface-variant/70">{FILTER_OPERATOR_LABELS[filter.operator]}</span>
          <span class="flex-1 truncate text-amber-400/90 bg-amber-400/10 rounded px-1"
            >{filter.value}</span
          >
          <button
            type="button"
            class="text-on-surface-variant hover:text-red-400 transition-colors shrink-0"
            onclick={() => store.removeCondition(i)}
            aria-label="Remove filter"
          >
            ×
          </button>
        </li>
      {/each}
    </ul>
    <p class="text-[10px] text-on-surface-variant">
      Showing {store.applyToFeatures(features).length} of {features.length} features
    </p>
  {/if}

  <!-- Add filter row -->
  {#if availableFields.length > 0}
    <div class="flex items-center gap-1">
      <!-- Field selector -->
      <select
        bind:value={newField}
        class="flex-1 min-w-0 rounded bg-surface-low border border-white/5 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary"
      >
        {#each availableFields as field (field)}
          <option value={field}>{field}</option>
        {/each}
      </select>

      <!-- Operator selector -->
      <select
        bind:value={newOperator}
        class="w-24 rounded bg-surface-low border border-white/5 px-2 py-1 text-xs text-white focus:outline-none focus:ring-1 focus:ring-primary"
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
        class="w-28 rounded bg-surface-low border border-white/5 px-2 py-1 text-xs text-white placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />

      <button
        type="button"
        class="rounded bg-primary-container hover:bg-primary px-2 py-1 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        onclick={addFilter}
        disabled={!newField || !newValue.trim() || addingFilter}
      >
        Add
      </button>
    </div>
    <p class="text-[10px] text-on-surface-variant/50 mt-0.5">
      Fields are detected from the first 100 features.
    </p>
  {:else}
    <p class="text-on-surface-variant/70 italic text-xs">Load layer data to add filters.</p>
  {/if}
</div>
