<script lang="ts">
  import '../app.css';
  import Toast from '$lib/components/ui/Toast.svelte';
  import OfflineBanner from '$lib/components/ui/OfflineBanner.svelte';
  import InstallPrompt from '$lib/components/ui/InstallPrompt.svelte';
  import UpdateBanner from '$lib/components/ui/UpdateBanner.svelte';
  import type { Snippet } from 'svelte';
  import { setUndoStore, createUndoStore } from '$lib/stores/undo.svelte.js';
  import { setHotOverlayStore, createHotOverlayStore } from '$lib/utils/map-sources.svelte.js';
  import { setLayersStore, createLayersStore } from '$lib/stores/layers.svelte.js';
  import { setStyleStore, createStyleStore } from '$lib/stores/style.svelte.js';
  import { setMapStore, createMapStore } from '$lib/stores/map.svelte.js';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  // Per-request store registration. Each SSR request creates fresh instances —
  // module-level $state would leak across concurrent requests under the Node adapter.
  setUndoStore(createUndoStore());
  setHotOverlayStore(createHotOverlayStore());
  setLayersStore(createLayersStore());
  setStyleStore(createStyleStore());
  setMapStore(createMapStore());

  // Global window.error / unhandledrejection listeners were removed in favor of
  // SvelteKit's +error.svelte routes and <svelte:boundary> in the map editor —
  // those mechanisms catch Svelte 5 hydration/render errors that the listeners
  // could not, and produce a recoverable UI rather than a blanket toast.
</script>

<OfflineBanner />
<UpdateBanner />
<InstallPrompt />
{@render children()}
<Toast />
