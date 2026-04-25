<script lang="ts">
  import ShareViewerScreen from '$lib/screens/ShareViewerScreen.svelte';
  import { invalidateAll } from '$app/navigation';
  import type { ShareViewerActions } from '$lib/contracts/share-viewer.js';
  import type { PageData } from './$types';
  import type { Layer } from '@felt-like-it/shared-types';

  let { data }: { data: PageData } = $props();

  const pageTitle = $derived('error' in data ? 'Link Not Found' : data.map.title);

  const actions: ShareViewerActions = {
    onRetry: async () => { await invalidateAll(); },
  };
</script>

<svelte:head>
  <title>{pageTitle} — Felt Like It</title>
</svelte:head>

{#if 'error' in data}
  <div class="flex min-h-screen items-center justify-center bg-surface-lowest">
    <div class="glass-panel rounded-xl p-8 text-center max-w-md">
      <h1 class="text-xl font-display text-on-surface mb-2">Link Not Found</h1>
      <p class="text-on-surface-variant text-sm">
        This share link is invalid or has expired. Please ask the map owner for a new link.
      </p>
    </div>
  </div>
{:else}
  <ShareViewerScreen
    data={{
      map: data.map,
      layers: data.layers.map((l) => ({
        ...l,
        createdAt: new Date(l.createdAt),
        updatedAt: new Date(l.updatedAt),
      })) as Layer[],
      shareToken: data.share.token,
    }}
    {actions}
    status="success"
  />
{/if}
