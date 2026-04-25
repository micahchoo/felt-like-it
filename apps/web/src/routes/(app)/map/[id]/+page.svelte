<script lang="ts">
  import MapEditorScreen from '$lib/screens/MapEditorScreen.svelte';
  import { invalidateAll } from '$app/navigation';
  import type { MapEditorData, MapEditorActions } from '$lib/contracts/map-editor.js';
  import type { PageData } from './$types';
  import type { Layer } from '@felt-like-it/shared-types';

  let { data }: { data: PageData } = $props();

  const editorData = $derived<MapEditorData>({
    map: {
      ...data.map,
      createdAt: new Date(data.map.createdAt),
      updatedAt: new Date(data.map.updatedAt),
    },
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

<svelte:boundary
  onerror={(error: unknown) => {
    console.error('[map-editor boundary]', error);
  }}
>
  <MapEditorScreen data={editorData} {actions} status="success" />

  {#snippet failed(error: unknown, reset: () => void)}
    <div class="flex min-h-screen items-center justify-center bg-surface-lowest px-4">
      <div class="glass-panel rounded-xl p-8 text-center max-w-md">
        <p class="text-xs font-display uppercase tracking-wider text-on-surface-variant mb-2">
          Map Editor Error
        </p>
        <h1 class="text-xl font-display text-on-surface mb-3">Couldn't render the map</h1>
        <p class="text-on-surface-variant text-sm mb-6">
          {error instanceof Error ? error.message : 'An unexpected error occurred while rendering the map.'}
        </p>
        <div class="flex gap-2 justify-center">
          <button
            type="button"
            onclick={async () => {
              await invalidateAll();
              reset();
            }}
            class="rounded-md bg-primary px-4 py-2 text-sm font-display uppercase tracking-wide text-on-primary hover:bg-primary/90 transition-colors"
          >
            Retry
          </button>
          <a
            href="/dashboard"
            class="rounded-md bg-surface-high px-4 py-2 text-sm font-display uppercase tracking-wide text-on-surface hover:bg-surface-high/80 transition-colors"
          >
            Back to dashboard
          </a>
        </div>
      </div>
    </div>
  {/snippet}
</svelte:boundary>
