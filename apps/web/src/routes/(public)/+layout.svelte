<script lang="ts">
  import '../../app.css';
  import Toast from '$lib/components/ui/Toast.svelte';
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

  // Embed/share layout — strips chrome inappropriate inside iframes/share viewers.
  // The root layout renders OfflineBanner, UpdateBanner, InstallPrompt + Toast — those
  // are jarring or actively harmful in an embedded context (iframe install prompt is
  // unactionable; offline/update banners reveal host-app implementation details).
  // Toast is preserved for inline error feedback (e.g. "share link expired") because
  // the public viewer still needs a way to surface failures to the embedded user.
  //
  // Per-request store registration mirrors the root layout — module-level $state
  // would leak across concurrent SSR requests under the Node adapter.
  setUndoStore(createUndoStore());
  setHotOverlayStore(createHotOverlayStore());
  setLayersStore(createLayersStore());
  setStyleStore(createStyleStore());
  setMapStore(createMapStore());
</script>

{@render children()}
<Toast />
