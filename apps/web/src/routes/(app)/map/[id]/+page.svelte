<script lang="ts">
  import MapEditorScreen from '$lib/screens/MapEditorScreen.svelte';
  import { invalidateAll } from '$app/navigation';
  import type { MapEditorData, MapEditorActions } from '$lib/contracts/map-editor.js';
  import type { PageData } from './$types';
  import type { Layer } from '@felt-like-it/shared-types';

  let { data }: { data: PageData } = $props();

  const editorData = $derived<MapEditorData>({
    map: data.map,
    layers: data.layers as Layer[],
    userId: data.userId,
    userRole: data.userRole as MapEditorData['userRole'],
    isOwner: data.userRole === 'owner',
    readonly: data.userRole === 'viewer' || data.userRole === 'commenter',
    embed: false,
  });

  const actions: MapEditorActions = {
    onRetry: async () => { await invalidateAll(); },
  };
</script>

<svelte:head>
  <title>{data.map.title} — Felt Like It</title>
</svelte:head>

<MapEditorScreen data={editorData} {actions} status="success" />
