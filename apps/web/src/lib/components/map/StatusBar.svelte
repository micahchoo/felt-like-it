<script lang="ts">
  interface Props {
    cursorLat: number | null;
    cursorLng: number | null;
    currentZoom: number;
  }

  let { cursorLat, cursorLng, currentZoom }: Props = $props();
</script>

<div class="flex items-center gap-4 px-3 py-1 bg-surface-lowest text-[10px] font-display uppercase tracking-wider text-on-surface-variant shrink-0 border-t border-surface-high">
  {#if cursorLat !== null && cursorLng !== null}
    <span>LAT {cursorLat.toFixed(4)}</span>
    <span>LNG {cursorLng.toFixed(4)}</span>
  {:else}
    <span>LAT —</span>
    <span>LNG —</span>
  {/if}
  <span class="text-on-surface-variant/50">|</span>
  <span>CRS EPSG:4326</span>
  <span>ZOOM {currentZoom.toFixed(1)}</span>
  <span class="ml-auto flex items-center gap-1.5">
    <span class="h-1.5 w-1.5 rounded-full bg-emerald-500 status-glow"></span>
    CONNECTED
  </span>
</div>
