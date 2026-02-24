<script lang="ts">
  /**
   * MeasurementPanel
   *
   * Floating overlay that displays the result of the most recent measurement
   * drawn by the user.  It is shown when `result` is non-null and the user is
   * in measurement mode.
   *
   * Props:
   * - `result`  — the latest `MeasurementResult` (null = no measurement yet)
   * - `onclear` — called when the user clicks "Clear" (parent should set
   *               result back to null and exit measurement mode)
   */
  import type { MeasurementResult, DistanceUnit, AreaUnit } from '@felt-like-it/geo-engine';
  import { DISTANCE_UNITS, AREA_UNITS, formatDistance, formatArea } from '@felt-like-it/geo-engine';

  interface Props {
    result: MeasurementResult | null;
    onclear: () => void;
  }

  let { result, onclear }: Props = $props();

  // Per-type unit selection — remembered while the panel is open
  let distUnit = $state<DistanceUnit>('km');
  let areaUnit = $state<AreaUnit>('km2');
  let periUnit = $state<DistanceUnit>('km');
</script>

<!--
  Floating panel — positioned absolute top-right of the map container.
  z-20 so it sits above map controls but below modal dialogs.
-->
<div
  class="absolute top-16 right-3 z-20 w-64 rounded-xl bg-slate-800/95 backdrop-blur-sm
         shadow-xl ring-1 ring-white/10 text-white text-sm"
  role="region"
  aria-label="Measurement results"
>
  <!-- Header -->
  <div class="flex items-center justify-between px-4 py-3 border-b border-white/10">
    <span class="font-semibold flex items-center gap-2">
      <!-- ruler icon -->
      <svg class="h-4 w-4 text-cyan-400" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M.5 14.5a.5.5 0 0 1-.354-.854l13-13a.5.5 0 0 1 .708.708l-13 13A.5.5 0 0 1 .5 14.5zM11 6.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM8 3.5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1a.5.5 0 0 1-.5-.5zM5 .5a.5.5 0 0 1 .5-.5h1a.5.5 0 0 1 0 1h-1A.5.5 0 0 1 5 .5zM.5 11.5a.5.5 0 0 1-.354-.854l1-1a.5.5 0 0 1 .708.708l-1 1a.5.5 0 0 1-.354.146zM3.5 8.5a.5.5 0 0 1-.354-.854l1-1a.5.5 0 0 1 .708.708l-1 1a.5.5 0 0 1-.354.146z"/>
      </svg>
      Measurement
    </span>
    <button
      onclick={onclear}
      class="text-slate-400 hover:text-white transition-colors text-xs px-2 py-1 rounded hover:bg-slate-700"
      aria-label="Clear measurement"
    >
      Clear
    </button>
  </div>

  <!-- Body -->
  <div class="px-4 py-3 space-y-3">
    {#if result === null}
      <!-- Instruction state — no measurement yet -->
      <p class="text-slate-400 text-xs leading-relaxed">
        Draw a <strong class="text-slate-300">line</strong> to measure distance, or a
        <strong class="text-slate-300">polygon</strong> to measure area.
        Click the last point twice to finish.
      </p>
    {:else if result.type === 'distance'}
      <!-- Distance measurement -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <span class="text-slate-400 text-xs uppercase tracking-wide">Distance</span>
          <select
            bind:value={distUnit}
            class="bg-slate-700 border border-white/10 rounded px-2 py-0.5 text-xs text-white"
            aria-label="Distance unit"
          >
            {#each DISTANCE_UNITS as u (u.value)}
              <option value={u.value}>{u.label}</option>
            {/each}
          </select>
        </div>
        <p class="text-2xl font-mono font-semibold text-cyan-300 tabular-nums">
          {formatDistance(result.distanceKm, distUnit)}
        </p>
        <p class="text-xs text-slate-500">
          {result.vertexCount} {result.vertexCount === 1 ? 'vertex' : 'vertices'}
        </p>
      </div>
    {:else}
      <!-- Area measurement -->
      <div class="space-y-3">
        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-slate-400 text-xs uppercase tracking-wide">Area</span>
            <select
              bind:value={areaUnit}
              class="bg-slate-700 border border-white/10 rounded px-2 py-0.5 text-xs text-white"
              aria-label="Area unit"
            >
              {#each AREA_UNITS as u (u.value)}
                <option value={u.value}>{u.label}</option>
              {/each}
            </select>
          </div>
          <p class="text-2xl font-mono font-semibold text-cyan-300 tabular-nums">
            {formatArea(result.areaM2, areaUnit)}
          </p>
        </div>

        <div>
          <div class="flex items-center justify-between mb-1">
            <span class="text-slate-400 text-xs uppercase tracking-wide">Perimeter</span>
            <select
              bind:value={periUnit}
              class="bg-slate-700 border border-white/10 rounded px-2 py-0.5 text-xs text-white"
              aria-label="Perimeter unit"
            >
              {#each DISTANCE_UNITS as u (u.value)}
                <option value={u.value}>{u.label}</option>
              {/each}
            </select>
          </div>
          <p class="text-lg font-mono font-semibold text-emerald-300 tabular-nums">
            {formatDistance(result.perimeterKm, periUnit)}
          </p>
        </div>

        <p class="text-xs text-slate-500">
          {result.vertexCount} {result.vertexCount === 1 ? 'vertex' : 'vertices'}
        </p>
      </div>
    {/if}
  </div>
</div>
