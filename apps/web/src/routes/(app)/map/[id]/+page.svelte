<script lang="ts">
  import { mapStore } from '$lib/stores/map.svelte.js';
  import MapEditor from '$lib/components/map/MapEditor.svelte';
  import type { PageData } from './$types';
  import type { Layer } from '@felt-like-it/shared-types';

  let { data }: { data: PageData } = $props();

  // Initialize map viewport from saved state
  $effect(() => {
    mapStore.loadViewport(data.map.viewport);
    mapStore.setBasemap(data.map.basemap as Parameters<typeof mapStore.setBasemap>[0]);
  });
</script>

<svelte:head>
  <title>{data.map.title} — Felt Like It</title>
</svelte:head>

<MapEditor
  mapId={data.map.id}
  mapTitle={data.map.title}
  initialLayers={data.layers as Layer[]}
  userId={data.userId}
  readonly={data.userRole === 'viewer' || data.userRole === 'commenter'}
  isOwner={data.userRole === 'owner'}
/>
