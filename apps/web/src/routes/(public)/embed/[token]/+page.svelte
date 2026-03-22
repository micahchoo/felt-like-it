<script lang="ts">
  import EmbedScreen from '$lib/screens/EmbedScreen.svelte';
  import type { ShareViewerData } from '$lib/contracts/share-viewer.js';
  import type { PageData } from './$types';
  import type { Layer } from '@felt-like-it/shared-types';

  let { data }: { data: PageData } = $props();

  const viewerData = $derived<ShareViewerData>({
    map: data.map,
    layers: data.layers as Layer[],
    shareToken: '',
  });
</script>

<svelte:head>
  <title>{data.map.title}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<EmbedScreen data={viewerData} status="success" />
