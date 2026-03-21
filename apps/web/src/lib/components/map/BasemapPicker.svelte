<script lang="ts">
  import { mapStore, BASEMAPS } from '$lib/stores/map.svelte.js';

  let open = $state(false);
</script>

<div class="relative">
  <button
    onclick={() => (open = !open)}
    class="flex items-center gap-1.5 rounded-lg bg-surface-container/90 backdrop-blur-sm px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-on-surface shadow-md ring-1 ring-surface-high transition-colors"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label="Change basemap"
  >
    <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M1.5 1.5A1.5 1.5 0 000 3v10a1.5 1.5 0 001.5 1.5h13A1.5 1.5 0 0016 13V3a1.5 1.5 0 00-1.5-1.5h-13zm1 2h11a.5.5 0 010 1h-11a.5.5 0 010-1zm0 3h5a.5.5 0 010 1h-5a.5.5 0 010-1zm0 3h3a.5.5 0 010 1h-3a.5.5 0 010-1z"/>
    </svg>
    <span class="font-display">Basemap</span>
    <svg class="h-3 w-3" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M6 8L1 3h10z"/>
    </svg>
  </button>

  {#if open}
    <!-- Click outside to close -->
    <button
      class="fixed inset-0 z-40 cursor-default"
      tabindex="-1"
      onclick={() => (open = false)}
      aria-hidden="true"
    ></button>

    <ul
      class="absolute bottom-full mb-1 left-0 z-50 bg-surface-container rounded-lg shadow-xl ring-1 ring-surface-high py-1 min-w-40"
      role="listbox"
      aria-label="Basemap options"
    >
      {#each BASEMAPS as basemap (basemap.id)}
        <li
          class="flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition-colors
                 {mapStore.basemapId === basemap.id
                   ? 'text-on-surface bg-primary/20'
                   : 'text-on-surface-variant hover:bg-surface-high hover:text-on-surface'}"
          role="option"
          aria-selected={mapStore.basemapId === basemap.id}
          onclick={() => {
            mapStore.setBasemap(basemap.id);
            open = false;
          }}
          onkeydown={(e) => {
            if (e.key === 'Enter') {
              mapStore.setBasemap(basemap.id);
              open = false;
            }
          }}
          tabindex="0"
        >
          {#if mapStore.basemapId === basemap.id}
            <svg class="h-3 w-3 text-primary shrink-0" viewBox="0 0 12 12" fill="currentColor">
              <path d="M10.28 2.28L4 8.56 1.72 6.28a.75.75 0 00-1.06 1.06l2.75 2.75a.75.75 0 001.06 0l6.75-6.75a.75.75 0 00-1.06-1.06z"/>
            </svg>
          {:else}
            <span class="w-3 shrink-0"></span>
          {/if}
          {basemap.label}
        </li>
      {/each}
    </ul>
  {/if}
</div>
