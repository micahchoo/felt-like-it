<script lang="ts">
  import type { MeasurementResult } from '$lib/stores/measurement-store.svelte.js';

  interface Props {
    result: MeasurementResult;
    position: { x: number; y: number };
    onsave: () => void;
    onclear: () => void;
  }

  let { result, position, onsave, onclear }: Props = $props();

  function formatValue(r: MeasurementResult): string {
    if (r.type === 'distance') {
      const km = r.distanceKm ?? r.value / 1000;
      return km >= 1 ? `${km.toFixed(2)} km` : `${r.value.toFixed(0)} m`;
    }
    const km2 = r.areaKm2 ?? r.value / 1000000;
    return km2 >= 1 ? `${km2.toFixed(2)} km²` : `${r.value.toFixed(0)} m²`;
  }

  function formatLabel(r: MeasurementResult): string {
    return r.type === 'distance' ? 'Distance' : 'Area';
  }
</script>

<div class="measurement-tooltip" style:left="{position.x}px" style:top="{position.y}px">
  <div class="tooltip-header">
    <span class="tooltip-label">{formatLabel(result)}</span>
    <span class="tooltip-value">{formatValue(result)}</span>
  </div>
  <div class="tooltip-meta">
    {result.vertexCount} vertices
  </div>
  <div class="tooltip-actions">
    <button class="btn btn-primary" type="button" onclick={onsave}> Save as annotation </button>
    <button class="btn btn-secondary" type="button" onclick={onclear}> Clear </button>
  </div>
</div>

<style>
  .measurement-tooltip {
    position: absolute;
    z-index: 1000;
    background: #1e1e2e;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 12px 16px;
    min-width: 200px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    pointer-events: auto;
    transform: translate(-50%, -100%);
    margin-top: -12px;
  }

  .tooltip-header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 8px;
    margin-bottom: 4px;
  }

  .tooltip-label {
    font-size: 12px;
    font-weight: 500;
    color: #a6adc8;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .tooltip-value {
    font-size: 18px;
    font-weight: 600;
    color: #cdd6f4;
    font-variant-numeric: tabular-nums;
  }

  .tooltip-meta {
    font-size: 11px;
    color: #6c7086;
    margin-bottom: 8px;
  }

  .tooltip-actions {
    display: flex;
    gap: 8px;
  }

  .btn {
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    border: none;
    transition: background-color 0.15s ease;
  }

  .btn-primary {
    background: #89b4fa;
    color: #1e1e2e;
  }

  .btn-primary:hover {
    background: #74c7ec;
  }

  .btn-secondary {
    background: transparent;
    color: #a6adc8;
    border: 1px solid rgba(255, 255, 255, 0.1);
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.05);
  }
</style>
