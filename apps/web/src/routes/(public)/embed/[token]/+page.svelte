<script lang="ts">
  import EmbedScreen from '$lib/screens/EmbedScreen.svelte';
  import type { ShareViewerData } from '$lib/contracts/share-viewer.js';
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
          shareToken: '',
        }
  );
</script>

<svelte:head>
  <title>{hasError ? 'Link Not Found' : data.map.title}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

{#if hasError}
  <div class="flex min-h-screen items-center justify-center bg-surface-lowest">
    <div class="glass-panel rounded-xl p-8 text-center max-w-md">
      <h1 class="text-xl font-display text-on-surface mb-2">Link Not Found</h1>
      <p class="text-on-surface-variant text-sm">
        This embed link is invalid or has expired.
      </p>
    </div>
  </div>
{:else if viewerData}
  <EmbedScreen data={viewerData} status="success" />
{/if}
