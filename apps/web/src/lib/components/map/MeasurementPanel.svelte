<script lang="ts">
  import type { MeasurementResult, DistanceUnit, AreaUnit } from '@felt-like-it/geo-engine';
  import { DISTANCE_UNITS, AREA_UNITS, formatDistance, formatArea } from '@felt-like-it/geo-engine';
  import { toastStore } from '$lib/components/ui/Toast.svelte';

  interface SaveAsAnnotationPayload {
    type: 'pendingMeasurement';
    anchor: {
      type: 'measurement';
      geometry:
        | { type: 'LineString'; coordinates: [number, number][] }
        | { type: 'Polygon'; coordinates: [number, number][][] };
    };
    content: {
      type: 'measurement';
      measurementType: 'distance' | 'area';
      value: number;
      unit: string;
      displayValue: string;
    };
  }

  interface Props {
    measureResult: MeasurementResult | null;
    onclear: () => void;
    onsaveasannotation: (payload: SaveAsAnnotationPayload) => void;
  }

  let { measureResult, onclear, onsaveasannotation }: Props = $props();

  // Own the unit state
  let distUnit = $state<DistanceUnit>('km');
  let areaUnit = $state<AreaUnit>('km2');
  let periUnit = $state<DistanceUnit>('km');
</script>

<div class="flex flex-col flex-1 min-h-0">
  <!-- Header -->
  <div class="px-4 pt-4 pb-3 border-b border-white/5">
    <div class="flex items-center gap-2 mb-0.5">
      <span class="inline-block w-2 h-2 rounded-full bg-amber-400 shadow-[0_0_6px_theme(colors.amber.400)]"></span>
      <span class="text-[10px] font-bold uppercase tracking-widest text-primary font-display">Live Measurement Mode</span>
    </div>
    <p class="text-[10px] text-on-surface-variant/60 font-mono pl-4">TurfJs Engine Active</p>
  </div>

  <!-- Body -->
  <div class="p-4 flex flex-col gap-3 flex-1">
    {#if measureResult === null}
      <div class="flex flex-col items-center justify-center py-8 text-center gap-2">
        <svg class="h-6 w-6 text-on-surface-variant/40 mb-1" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M.5 14.5a.5.5 0 0 1-.354-.854l13-13a.5.5 0 0 1 .708.708l-13 13A.5.5 0 0 1 .5 14.5zM11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM8 3.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM5 .5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 5 .5z"/>
        </svg>
        <p class="text-sm text-on-surface-variant">Draw a line to measure distance, or a polygon for area and perimeter.</p>
        <p class="text-xs text-on-surface-variant/50 mt-1">Use the drawing tools on the left. Click to add points, double-click to finish.</p>
      </div>
    {:else if measureResult.type === 'distance'}
      <!-- Distance stat cards (2x2 grid, only 2 relevant) -->
      <div class="grid grid-cols-2 gap-2">
        <!-- Total Distance -->
        <div class="col-span-2 rounded bg-surface-container-low border border-white/5 p-3">
          <span class="text-[10px] font-bold uppercase tracking-widest text-primary">Total Distance</span>
          <p class="text-3xl font-mono font-semibold text-on-surface tabular-nums leading-tight mt-1">
            {formatDistance(measureResult.distanceKm, distUnit)}
          </p>
        </div>
        <!-- Nodes / Segments -->
        <div class="col-span-2 rounded bg-surface-container-low border border-white/5 p-3">
          <span class="text-[10px] font-bold uppercase tracking-widest text-primary">Nodes / Segments</span>
          <p class="text-3xl font-mono font-semibold text-on-surface tabular-nums leading-tight mt-1">
            {measureResult.vertexCount}
            <span class="text-sm text-on-surface-variant/60 font-normal">/ {Math.max(0, measureResult.vertexCount - 1)}</span>
          </p>
        </div>
      </div>
      <!-- Unit toggle -->
      <div class="flex items-center gap-1 flex-wrap">
        <span class="text-[10px] uppercase tracking-widest text-on-surface-variant/50 mr-1">Unit</span>
        {#each DISTANCE_UNITS as u (u.value)}
          <button
            type="button"
            class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border transition-colors {distUnit === u.value ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-surface-container-low border-white/5 text-on-surface-variant hover:border-white/20'}"
            onclick={() => { distUnit = u.value; }}
          >{u.label}</button>
        {/each}
      </div>
    {:else}
      <!-- Area stat cards (2x2 grid) -->
      <div class="grid grid-cols-2 gap-2">
        <!-- Calculated Area -->
        <div class="col-span-2 rounded bg-surface-container-low border border-white/5 p-3">
          <span class="text-[10px] font-bold uppercase tracking-widest text-primary">Calculated Area</span>
          <p class="text-3xl font-mono font-semibold text-on-surface tabular-nums leading-tight mt-1">
            {formatArea(measureResult.areaM2, areaUnit)}
          </p>
        </div>
        <!-- Perimeter -->
        <div class="col-span-1 rounded bg-surface-container-low border border-white/5 p-3">
          <span class="text-[10px] font-bold uppercase tracking-widest text-primary">Perimeter</span>
          <p class="text-2xl font-mono font-semibold text-on-surface tabular-nums leading-tight mt-1">
            {formatDistance(measureResult.perimeterKm, periUnit)}
          </p>
        </div>
        <!-- Nodes / Segments -->
        <div class="col-span-1 rounded bg-surface-container-low border border-white/5 p-3">
          <span class="text-[10px] font-bold uppercase tracking-widest text-primary">Nodes / Segs</span>
          <p class="text-2xl font-mono font-semibold text-on-surface tabular-nums leading-tight mt-1">
            {measureResult.vertexCount}
            <span class="text-sm text-on-surface-variant/60 font-normal">/ {Math.max(0, measureResult.vertexCount - 1)}</span>
          </p>
        </div>
      </div>
      <!-- Unit toggles -->
      <div class="flex flex-col gap-2">
        <div class="flex items-center gap-1 flex-wrap">
          <span class="text-[10px] uppercase tracking-widest text-on-surface-variant/50 w-16">Area</span>
          {#each AREA_UNITS as u (u.value)}
            <button
              type="button"
              class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border transition-colors {areaUnit === u.value ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-surface-container-low border-white/5 text-on-surface-variant hover:border-white/20'}"
              onclick={() => { areaUnit = u.value; }}
            >{u.label}</button>
          {/each}
        </div>
        <div class="flex items-center gap-1 flex-wrap">
          <span class="text-[10px] uppercase tracking-widest text-on-surface-variant/50 w-16">Perim.</span>
          {#each DISTANCE_UNITS as u (u.value)}
            <button
              type="button"
              class="px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase border transition-colors {periUnit === u.value ? 'bg-primary/20 border-primary/50 text-primary' : 'bg-surface-container-low border-white/5 text-on-surface-variant hover:border-white/20'}"
              onclick={() => { periUnit = u.value; }}
            >{u.label}</button>
          {/each}
        </div>
      </div>
    {/if}

    {#if measureResult !== null}
      <!-- Actions -->
      <div class="flex items-center gap-2 mt-auto pt-2 border-t border-white/5">
        <button
          type="button"
          onclick={onclear}
          class="flex-1 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded bg-surface-container-low border border-white/5 text-on-surface-variant hover:text-on-surface hover:border-white/20 transition-colors"
        >
          Clear
        </button>
        <button
          type="button"
          class="flex-1 text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded bg-primary/20 border border-primary/40 text-primary hover:bg-primary/30 transition-colors"
          onclick={() => {
            if (!measureResult) return;
            const mr = measureResult;
            if (mr.type === 'distance') {
              onsaveasannotation({
                type: 'pendingMeasurement',
                anchor: {
                  type: 'measurement',
                  geometry: { type: 'LineString', coordinates: mr.coordinates as [number, number][] },
                },
                content: {
                  type: 'measurement',
                  measurementType: 'distance',
                  value: mr.distanceKm * 1000,
                  unit: distUnit,
                  displayValue: formatDistance(mr.distanceKm, distUnit),
                },
              });
            } else {
              onsaveasannotation({
                type: 'pendingMeasurement',
                anchor: {
                  type: 'measurement',
                  geometry: { type: 'Polygon', coordinates: mr.coordinates as [number, number][][] },
                },
                content: {
                  type: 'measurement',
                  measurementType: 'area',
                  value: mr.areaM2,
                  unit: areaUnit,
                  displayValue: formatArea(mr.areaM2, areaUnit),
                },
              });
            }
            toastStore.success('Measurement saved as annotation.');
          }}
        >
          Save Annotation
        </button>
      </div>
    {/if}
  </div>
</div>
