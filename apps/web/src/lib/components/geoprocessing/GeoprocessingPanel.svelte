<script lang="ts">
  import { trpc } from '$lib/utils/trpc.js';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { queryKeys } from '$lib/utils/query-keys.js';
  import Button from '$lib/components/ui/Button.svelte';
  import type { Layer } from '@felt-like-it/shared-types';
  import { GEO_OP_LABELS } from '@felt-like-it/shared-types';
  import type { GeoprocessingOp } from '@felt-like-it/shared-types';

  interface Props {
    mapId: string;
    layers: Layer[];
    /** Called with the new layer id after a successful operation. */
    onlayercreated: (_layerId: string) => void;
    embedded?: boolean;
  }

  let { mapId, layers, onlayercreated, embedded }: Props = $props();

  const queryClient = useQueryClient();

  const geoprocessingMutation = createMutation(() => ({
    mutationFn: (input: { mapId: string; op: GeoprocessingOp; outputLayerName: string }) =>
      trpc.geoprocessing.run.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.layers.list({ mapId }) });
    },
  }));

  // Op type is constrained to the discriminated union keys — no stringly-typed widening
  type OpType = GeoprocessingOp['type'];
  const OP_TYPES = Object.keys(GEO_OP_LABELS) as OpType[];
  const TWO_LAYER_OPS: ReadonlySet<OpType> = new Set<OpType>([
    'intersect', 'clip', 'point_in_polygon', 'nearest_neighbor', 'aggregate',
  ]);
  const DIST_OPS:  ReadonlySet<OpType> = new Set<OpType>(['buffer']);
  const FIELD_OPS: ReadonlySet<OpType> = new Set<OpType>(['dissolve']);
  const AGG_OPS:   ReadonlySet<OpType> = new Set<OpType>(['aggregate']);

  let opType      = $state<OpType>('buffer');
  // Initialised empty; $effect.pre sets the default from the first available layer.
  // This avoids the `state_referenced_locally` Svelte warning while allowing user overrides.
  let layerIdA    = $state('');
  let layerIdB    = $state('');
  let distanceKm  = $state(1);

  $effect.pre(() => {
    if (!layerIdA && layers.length > 0) layerIdA = layers[0]?.id ?? '';
    if (!layerIdB && layers.length > 0) layerIdB = layers[1]?.id ?? layers[0]?.id ?? '';
  });
  let dissolveField = $state('');
  let aggregation   = $state<'count' | 'sum' | 'avg'>('count');
  let aggField      = $state('');
  let aggOutputField = $state('');
  let outputName  = $state('');
  let running     = $state(false);
  let error       = $state<string | null>(null);
  let success     = $state<string | null>(null);

  // Auto-generate output layer name when op or primary layer changes
  const primaryLayer = $derived(layers.find((l) => l.id === layerIdA));
  const defaultName  = $derived(computeDefaultName(opType, primaryLayer?.name));
  $effect(() => { outputName = defaultName; });

  function computeDefaultName(op: OpType, layerName?: string): string {
    const base = layerName ?? 'Layer';
    const labels: Record<OpType, string> = {
      buffer:           `${base} (buffered)`,
      convex_hull:      `${base} (convex hull)`,
      centroid:         `${base} (centroids)`,
      dissolve:         `${base} (dissolved)`,
      intersect:        'Intersection',
      union:            `${base} (union)`,
      clip:             `${base} (clipped)`,
      point_in_polygon: `${base} (point join)`,
      nearest_neighbor: `${base} (nearest join)`,
      aggregate:        `${base} (aggregated)`,
    };
    return labels[op];
  }

  function getLayerALabel(op: OpType): string {
    if (op === 'point_in_polygon' || op === 'aggregate') return 'Points layer';
    if (TWO_LAYER_OPS.has(op)) return 'Layer A (source)';
    return 'Layer';
  }

  function getLayerBLabel(op: OpType): string {
    if (op === 'point_in_polygon' || op === 'aggregate') return 'Polygons layer';
    if (op === 'clip') return 'Layer B (clip mask)';
    return 'Layer B';
  }

  /** Build the strongly-typed discriminated union from panel state. */
  function buildOp(): GeoprocessingOp {
    switch (opType) {
      case 'buffer':
        return { type: 'buffer', layerId: layerIdA, distanceKm };
      case 'convex_hull':
        return { type: 'convex_hull', layerId: layerIdA };
      case 'centroid':
        return { type: 'centroid', layerId: layerIdA };
      case 'dissolve':
        return { type: 'dissolve', layerId: layerIdA, ...(dissolveField.trim() ? { field: dissolveField.trim() } : {}) };
      case 'intersect':
        return { type: 'intersect', layerIdA, layerIdB };
      case 'union':
        return { type: 'union', layerId: layerIdA };
      case 'clip':
        return { type: 'clip', layerIdA, layerIdB };
      case 'point_in_polygon':
        return { type: 'point_in_polygon', layerIdPoints: layerIdA, layerIdPolygons: layerIdB };
      case 'nearest_neighbor':
        return { type: 'nearest_neighbor', layerIdA, layerIdB };
      case 'aggregate':
        return {
          type: 'aggregate',
          layerIdPoints: layerIdA,
          layerIdPolygons: layerIdB,
          aggregation,
          ...(aggField.trim() ? { field: aggField.trim() } : {}),
          ...(aggOutputField.trim() ? { outputField: aggOutputField.trim() } : {}),
        };
    }
  }

  async function handleRun(e: Event) {
    e.preventDefault();
    if (!layerIdA) return;
    if (TWO_LAYER_OPS.has(opType) && !layerIdB) return;
    running = true;
    error = null;
    success = null;
    try {
      const result = await geoprocessingMutation.mutateAsync({
        mapId,
        op: buildOp(),
        outputLayerName: outputName.trim() || defaultName,
      });
      success = `Created layer "${result.layerName}"`;
      onlayercreated(result.layerId);
    } catch (err: unknown) {
      error = (err as { message?: string })?.message ?? 'Geoprocessing failed.';
    } finally {
      running = false;
    }
  }
</script>

<div class="flex flex-col h-full {embedded !== true ? 'bg-slate-800 border-l border-white/10' : ''}">
  {#if embedded !== true}
  <!-- Header -->
  <div class="px-3 py-2 border-b border-white/10 shrink-0">
    <span class="text-xs font-semibold text-slate-400 uppercase tracking-wide">Geoprocessing</span>
  </div>
  {/if}

  {#if layers.length === 0}
    <div class="flex flex-col items-center justify-center py-12 px-4 text-center flex-1">
      <svg class="h-6 w-6 text-slate-500 mb-2" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0a8 8 0 100 16A8 8 0 008 0zm3.5 7.5a.5.5 0 010 1H5.707l2.147 2.146a.5.5 0 01-.708.708l-3-3a.5.5 0 010-.708l3-3a.5.5 0 11.708.708L5.707 7.5H11.5z"/>
      </svg>
      <p class="text-sm text-slate-400">Add a layer with features first, then run spatial operations here.</p>
    </div>
  {:else}
  <!-- Form -->
  <form onsubmit={handleRun} class="flex-1 overflow-y-auto p-3 flex flex-col gap-3">

    <!-- Operation selector -->
    <div class="flex flex-col gap-1">
      <label class="text-xs text-slate-400" for="geo-op">Operation</label>
      <select
        id="geo-op"
        bind:value={opType}
        class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {#each OP_TYPES as op (op)}
          <option value={op}>{GEO_OP_LABELS[op]}</option>
        {/each}
      </select>
    </div>

    <!-- Layer A -->
    <div class="flex flex-col gap-1">
      <label class="text-xs text-slate-400" for="geo-layer-a">
        {getLayerALabel(opType)}
      </label>
      <select
        id="geo-layer-a"
        bind:value={layerIdA}
        class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
      >
        {#each layers as layer (layer.id)}
          <option value={layer.id}>{layer.name}</option>
        {/each}
      </select>
    </div>

    <!-- Layer B (only for two-layer ops) -->
    {#if TWO_LAYER_OPS.has(opType)}
      <div class="flex flex-col gap-1">
        <label class="text-xs text-slate-400" for="geo-layer-b">
          {getLayerBLabel(opType)}
        </label>
        <select
          id="geo-layer-b"
          bind:value={layerIdB}
          class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {#each layers as layer (layer.id)}
            <option value={layer.id}>{layer.name}</option>
          {/each}
        </select>
      </div>
    {/if}

    <!-- Buffer distance -->
    {#if DIST_OPS.has(opType)}
      <div class="flex flex-col gap-1">
        <label class="text-xs text-slate-400" for="geo-dist">Distance (km)</label>
        <input
          id="geo-dist"
          type="number"
          min="0.001"
          max="1000"
          step="0.1"
          bind:value={distanceKm}
          class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    {/if}

    <!-- Dissolve field -->
    {#if FIELD_OPS.has(opType)}
      <div class="flex flex-col gap-1">
        <label class="text-xs text-slate-400" for="geo-field">
          Dissolve by field <span class="text-slate-500">(optional)</span>
        </label>
        <input
          id="geo-field"
          type="text"
          placeholder="property name"
          bind:value={dissolveField}
          class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    {/if}

    <!-- Aggregation controls -->
    {#if AGG_OPS.has(opType)}
      <div class="flex flex-col gap-1">
        <label class="text-xs text-slate-400" for="geo-agg">Aggregation</label>
        <select
          id="geo-agg"
          bind:value={aggregation}
          class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="count">Count</option>
          <option value="sum">Sum</option>
          <option value="avg">Average</option>
        </select>
      </div>
      {#if aggregation === 'sum' || aggregation === 'avg'}
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="geo-agg-field">
            Point property <span class="text-slate-500">(numeric)</span>
          </label>
          <input
            id="geo-agg-field"
            type="text"
            placeholder="property name"
            bind:value={aggField}
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      {/if}
      <div class="flex flex-col gap-1">
        <label class="text-xs text-slate-400" for="geo-agg-out">
          Output field name <span class="text-slate-500">(optional)</span>
        </label>
        <input
          id="geo-agg-out"
          type="text"
          placeholder={aggregation}
          bind:value={aggOutputField}
          class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    {/if}

    <!-- Output layer name -->
    <div class="flex flex-col gap-1">
      <label class="text-xs text-slate-400" for="geo-name">Output layer name</label>
      <input
        id="geo-name"
        type="text"
        bind:value={outputName}
        class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>

    <!-- Feedback -->
    {#if error}
      <p class="text-xs text-red-400">{error}</p>
    {/if}
    {#if success}
      <p class="text-xs text-green-400">{success}</p>
    {/if}

    <!-- Run -->
    <Button
      type="submit"
      size="sm"
      loading={running}
      disabled={!layerIdA
        || (TWO_LAYER_OPS.has(opType) && !layerIdB)
        || (AGG_OPS.has(opType) && aggregation !== 'count' && !aggField.trim())}
    >
      Run
    </Button>
  </form>
  {/if}
</div>
