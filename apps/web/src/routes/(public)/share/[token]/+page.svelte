<script lang="ts">
  import ShareViewerScreen from '$lib/screens/ShareViewerScreen.svelte';
  import { invalidateAll } from '$app/navigation';
  import type { ShareViewerData, ShareViewerActions } from '$lib/contracts/share-viewer.js';
  import type { PageData } from './$types';
  import type { Layer } from '@felt-like-it/shared-types';

  let { data }: { data: PageData } = $props();

  const viewerData = $derived<ShareViewerData>({
    map: data.map,
    layers: data.layers as Layer[],
    shareToken: data.share.token,
  });

  const actions: ShareViewerActions = {
    onRetry: async () => { await invalidateAll(); },
  };
</script>

<svelte:head>
  <title>{data.map.title} — Felt Like It</title>
</svelte:head>

<ShareViewerScreen data={viewerData} {actions} status="success" />
