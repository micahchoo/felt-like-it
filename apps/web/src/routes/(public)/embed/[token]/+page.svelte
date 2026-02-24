<script lang="ts">
  import { mapStore } from '$lib/stores/map.svelte.js';
  import MapEditor from '$lib/components/map/MapEditor.svelte';
  import type { PageData } from './$types';
  import type { Layer } from '@felt-like-it/shared-types';

  let { data }: { data: PageData } = $props();

  $effect(() => {
    mapStore.loadViewport(data.map.viewport);
    mapStore.setBasemap(data.map.basemap as Parameters<typeof mapStore.setBasemap>[0]);
  });
</script>

<svelte:head>
  <title>{data.map.title}</title>
  <!-- Prevent search engines from indexing embed views -->
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<!--
  embed=true: no toolbar, no layer panel, no basemap picker, no side panels.
  readonly=true is implied by embed — no drawing tools or write operations.
-->
<MapEditor
  mapId={data.map.id}
  mapTitle={data.map.title}
  initialLayers={data.layers as Layer[]}
  embed={true}
/>
