<script lang="ts">
  import ShareViewerScreen from '$lib/screens/ShareViewerScreen.svelte';
  import { invalidateAll } from '$app/navigation';
  import type { ShareViewerData, ShareViewerActions } from '$lib/contracts/share-viewer.js';
  import type { PageData } from './$types';
  import type { Layer } from '@felt-like-it/shared-types';

  let { data }: { data: PageData } = $props();

  const hasError = $derived('error' in data && data.error === 'not_found');

  const viewerData = $derived<ShareViewerData | null>(
    hasError
      ? null
      : {
          map: data.map,
          layers: data.layers as Layer[],
          shareToken: data.share.token,
        }
  );

  const actions: ShareViewerActions = {
    onRetry: async () => { await invalidateAll(); },
  };
</script>

<svelte:head>
  <title>{hasError ? 'Link Not Found' : data.map.title} — Felt Like It</title>
</svelte:head>

{#if hasError}
  <div class="flex min-h-screen items-center justify-center bg-surface-lowest">
    <div class="glass-panel rounded-xl p-8 text-center max-w-md">
      <h1 class="text-xl font-display text-on-surface mb-2">Link Not Found</h1>
      <p class="text-on-surface-variant text-sm">
        This share link is invalid or has expired. Please ask the map owner for a new link.
      </p>
    </div>
  </div>
{:else if viewerData}
  <ShareViewerScreen data={viewerData} {actions} status="success" />
{/if}
