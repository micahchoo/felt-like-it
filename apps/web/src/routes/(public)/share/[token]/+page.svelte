<script lang="ts">
  import { onMount } from 'svelte';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import MapEditor from '$lib/components/map/MapEditor.svelte';
  import GuestCommentPanel from '$lib/components/map/GuestCommentPanel.svelte';
  import type { PageData } from './$types';
  import type { Layer } from '@felt-like-it/shared-types';

  let { data }: { data: PageData } = $props();

  let showComments = $state(false);
  let embedCopied = $state(false);

  onMount(() => {
    mapStore.loadViewport(data.map.viewport);
    mapStore.setBasemap(data.map.basemap as Parameters<typeof mapStore.setBasemap>[0]);
  });

  function copyEmbedCode() {
    const embedUrl = `${window.location.origin}/embed/${data.share.token}`;
    const html = `<iframe src="${embedUrl}" width="100%" height="500" frameborder="0" allowfullscreen title="${data.map.title}"></iframe>`;
    navigator.clipboard.writeText(html).then(() => {
      embedCopied = true;
      setTimeout(() => { embedCopied = false; }, 2000);
    }).catch(() => undefined);
  }
</script>

<svelte:head>
  <title>{data.map.title} — Felt Like It</title>
</svelte:head>

<div class="relative">
  <MapEditor
    mapId={data.map.id}
    mapTitle={data.map.title}
    initialLayers={data.layers as Layer[]}
    readonly={true}
  />

  <!-- Embed button — top-[2.875rem] clears the MapEditor toolbar (~46px tall) -->
  <button
    class="absolute top-[2.875rem] left-3 z-10 flex items-center gap-1.5 rounded bg-slate-800/90 border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white transition-colors backdrop-blur-sm"
    onclick={copyEmbedCode}
    title="Copy iframe embed code to clipboard"
    aria-label="Copy embed code"
  >
    <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5.854 4.646a.5.5 0 010 .708L3.207 8l2.647 2.646a.5.5 0 01-.708.708l-3-3a.5.5 0 010-.708l3-3a.5.5 0 01.708 0zm4.292 0a.5.5 0 000 .708L12.793 8l-2.647 2.646a.5.5 0 00.708.708l3-3a.5.5 0 000-.708l-3-3a.5.5 0 00-.708 0z"/>
    </svg>
    {embedCopied ? 'Copied!' : 'Embed'}
  </button>

  <!-- Map title — centered between the two action buttons -->
  <div class="absolute top-[2.875rem] left-1/2 -translate-x-1/2 z-10 max-w-xs pointer-events-none">
    <h1 class="text-sm font-medium text-white truncate drop-shadow">{data.map.title}</h1>
  </div>

  <!-- Floating comments toggle -->
  <button
    class="absolute top-[2.875rem] right-3 z-10 flex items-center gap-1.5 rounded bg-slate-800/90 border border-white/10 px-2.5 py-1.5 text-xs text-slate-300 hover:text-white transition-colors backdrop-blur-sm"
    onclick={() => (showComments = !showComments)}
  >
    <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M14 1a1 1 0 011 1v8a1 1 0 01-1 1H4.414A2 2 0 003 11.586l-2 2V2a1 1 0 011-1h12zm-3 3.5a.5.5 0 000-1h-6a.5.5 0 000 1h6zm0 2.5a.5.5 0 000-1h-6a.5.5 0 000 1h6zm0 2.5a.5.5 0 000-1h-3a.5.5 0 000 1h3z"/>
    </svg>
    Comments
  </button>

  <!-- Slide-in comment panel -->
  {#if showComments}
    <div class="absolute inset-y-0 right-0 w-72 z-10">
      <GuestCommentPanel shareToken={data.share.token} />
    </div>
  {/if}
</div>
