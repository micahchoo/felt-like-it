<script lang="ts">
  import type { MeasurementResult, DistanceUnit, AreaUnit } from '@felt-like-it/geo-engine';
  import { DISTANCE_UNITS, AREA_UNITS, formatDistance, formatArea } from '@felt-like-it/geo-engine';

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

<div class="p-4 flex-1">
  {#if measureResult === null}
    <div class="flex flex-col items-center justify-center py-8 text-center">
      <svg class="h-6 w-6 text-slate-500 mb-2" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M.5 14.5a.5.5 0 0 1-.354-.854l13-13a.5.5 0 0 1 .708.708l-13 13A.5.5 0 0 1 .5 14.5zM11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM8 3.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM5 .5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 5 .5z"/>
      </svg>
      <p class="text-sm text-slate-400">Draw a line to measure distance, or a polygon for area and perimeter.</p>
      <p class="text-xs text-slate-500 mt-1">Use the drawing tools on the left. Click to add points, double-click to finish. You can also select an existing feature and click "Measure" to measure it.</p>
    </div>
  {:else if measureResult.type === 'distance'}
    <div class="space-y-2">
      <span class="text-slate-400 text-xs uppercase tracking-wide">Distance</span>
      <p class="text-2xl font-mono font-semibold text-cyan-300 tabular-nums">
        {formatDistance(measureResult.distanceKm, distUnit)}
      </p>
      <div class="flex items-center gap-2">
        <select bind:value={distUnit} class="bg-slate-700 border border-white/10 rounded px-2 py-0.5 text-xs text-white" aria-label="Distance unit">
          {#each DISTANCE_UNITS as u (u.value)}
            <option value={u.value}>{u.label}</option>
          {/each}
        </select>
        <span class="text-xs text-slate-500">{measureResult.vertexCount} {measureResult.vertexCount === 1 ? 'vertex' : 'vertices'}</span>
      </div>
    </div>
  {:else}
    <div class="space-y-2">
      <span class="text-slate-400 text-xs uppercase tracking-wide">Area</span>
      <p class="text-2xl font-mono font-semibold text-cyan-300 tabular-nums">
        {formatArea(measureResult.areaM2, areaUnit)}
      </p>
      <select bind:value={areaUnit} class="bg-slate-700 border border-white/10 rounded px-2 py-0.5 text-xs text-white" aria-label="Area unit">
        {#each AREA_UNITS as u (u.value)}
          <option value={u.value}>{u.label}</option>
        {/each}
      </select>
      <div class="mt-2">
        <span class="text-slate-400 text-xs uppercase tracking-wide">Perimeter</span>
        <p class="text-lg font-mono font-semibold text-emerald-300 tabular-nums">
          {formatDistance(measureResult.perimeterKm, periUnit)}
        </p>
        <select bind:value={periUnit} class="bg-slate-700 border border-white/10 rounded px-2 py-0.5 text-xs text-white" aria-label="Perimeter unit">
          {#each DISTANCE_UNITS as u (u.value)}
            <option value={u.value}>{u.label}</option>
          {/each}
        </select>
      </div>
      <span class="text-xs text-slate-500">{measureResult.vertexCount} {measureResult.vertexCount === 1 ? 'vertex' : 'vertices'}</span>
    </div>
  {/if}
  {#if measureResult !== null}
    <div class="flex items-center gap-3 mt-3">
      <button onclick={onclear} class="text-xs text-slate-400 hover:text-white transition-colors">
        Clear measurement
      </button>
      <button
        type="button"
        class="text-xs px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white"
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
        }}
      >
        Save as annotation
      </button>
    </div>
  {/if}
</div>
