<script lang="ts">
  import { trpc } from '$lib/utils/trpc.js';
  import Button from '$lib/components/ui/Button.svelte';
  import type { Layer } from '@felt-like-it/shared-types';
  import { GEO_OP_LABELS } from '@felt-like-it/shared-types';
  import type { GeoprocessingOp } from '@felt-like-it/shared-types';

  interface Props {
    mapId: string;
    layers: Layer[];
    /** Called with the new layer id after a successful operation. */
    onlayercreated: (_layerId: string) => void;
  }

  let { mapId, layers, onlayercreated }: Props = $props();

  // Op type is constrained to the discriminated union keys — no stringly-typed widening
  type OpType = GeoprocessingOp['type'];
  const OP_TYPES = Object.keys(GEO_OP_LABELS) as OpType[];
  const TWO_LAYER_OPS: ReadonlySet<OpType> = new Set<OpType>(['intersect', 'clip']);
  const DIST_OPS:     ReadonlySet<OpType> = new Set<OpType>(['buffer']);
  const FIELD_OPS:    ReadonlySet<OpType> = new Set<OpType>(['dissolve']);

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
      buffer:      `${base} (buffered)`,
      convex_hull: `${base} (convex hull)`,
      centroid:    `${base} (centroids)`,
      dissolve:    `${base} (dissolved)`,
      intersect:   'Intersection',
      union:       `${base} (union)`,
      clip:        `${base} (clipped)`,
    };
    return labels[op];
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
      const result = await trpc.geoprocessing.run.mutate({
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

<div class="flex flex-col h-full bg-slate-800 border-l border-white/10">
  <!-- Header -->
  <div class="px-3 py-2 border-b border-white/10 shrink-0">
    <span class="text-xs font-semibold text-slate-400 uppercase tracking-wide">Geoprocessing</span>
  </div>

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
        {TWO_LAYER_OPS.has(opType) ? 'Layer A (source)' : 'Layer'}
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
          {opType === 'clip' ? 'Layer B (clip mask)' : 'Layer B (mask)'}
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
      disabled={!layerIdA || (TWO_LAYER_OPS.has(opType) && !layerIdB)}
    >
      Run
    </Button>
  </form>
</div>
