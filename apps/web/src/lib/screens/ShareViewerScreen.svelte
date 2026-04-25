<script lang="ts">
	import { onMount } from 'svelte';
	import type { ShareViewerData, ShareViewerActions, ShareViewerStatus } from '$lib/contracts/share-viewer.js';
	import { getMapStore } from '$lib/stores/map.svelte.js';
	const mapStore = getMapStore();
	import MapEditor from '$lib/components/map/MapEditor.svelte';
	import GuestCommentPanel from '$lib/components/map/GuestCommentPanel.svelte';
	import SkeletonLoader from '$lib/components/ui/SkeletonLoader.svelte';
	import ErrorState from '$lib/components/ui/ErrorState.svelte';
	import { startShareViewportHashSync } from '$lib/utils/use-share-viewport-hash.svelte.js';
	import type { Layer } from '@felt-like-it/shared-types';

	interface Props {
		data: ShareViewerData;
		actions: ShareViewerActions;
		status: ShareViewerStatus;
	}

	let { data, actions, status }: Props = $props();

	let showComments = $state(false);
	let embedCopied = $state(false);

	onMount(() => {
		mapStore.loadViewport(data.map.viewport);
		mapStore.setBasemap(data.map.basemap as Parameters<typeof mapStore.setBasemap>[0]);
	});

	// F13.1 — bidirectional sync between location.hash and the map viewport.
	// Wires once the map instance becomes available (set by MapEditor on mount).
	// If the share URL has #zoom/lat/lng, this overrides the owner-saved viewport.
	$effect(() => {
		const map = mapStore.mapInstance;
		if (!map) return;
		return startShareViewportHashSync(map, mapStore);
	});

	function copyEmbedCode() {
		const embedUrl = `${window.location.origin}/embed/${data.shareToken}`;
		const html = `<iframe src="${embedUrl}" width="100%" height="500" frameborder="0" allowfullscreen title="${data.map.title}"></iframe>`;
		navigator.clipboard.writeText(html).then(() => {
			embedCopied = true;
			setTimeout(() => { embedCopied = false; }, 2000);
		}).catch(() => undefined);
	}
</script>

{#if status === 'loading'}
	<div class="h-screen bg-surface flex items-center justify-center">
		<SkeletonLoader layout="editor" />
	</div>
{:else if status === 'error'}
	<div class="h-screen bg-surface flex items-center justify-center">
		<ErrorState message="Failed to load shared map." onretry={actions.onRetry} />
	</div>
{:else}
	<div class="relative">
		<MapEditor
			mapId={data.map.id}
			mapTitle={data.map.title}
			initialLayers={data.layers as Layer[]}
			readonly={true}
		/>

		<button
			class="absolute top-[2.875rem] left-3 z-10 flex items-center gap-1.5 rounded glass-panel border border-white/5 px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
			onclick={copyEmbedCode}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
				<path d="M5.854 4.646a.5.5 0 010 .708L3.207 8l2.647 2.646a.5.5 0 01-.708.708l-3-3a.5.5 0 010-.708l3-3a.5.5 0 01.708 0zm4.292 0a.5.5 0 000 .708L12.793 8l-2.647 2.646a.5.5 0 00.708.708l3-3a.5.5 0 000-.708l-3-3a.5.5 0 00-.708 0z"/>
			</svg>
			{embedCopied ? 'Copied!' : 'Embed'}
		</button>

		<div class="absolute top-[2.875rem] left-1/2 -translate-x-1/2 z-10 max-w-xs pointer-events-none">
			<h1 class="text-sm font-medium text-white truncate drop-shadow">{data.map.title}</h1>
		</div>

		<button
			class="absolute top-[2.875rem] right-3 z-10 flex items-center gap-1.5 rounded glass-panel border border-white/5 px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
			onclick={() => (showComments = !showComments)}
		>
			<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
				<path d="M14 1a1 1 0 011 1v8a1 1 0 01-1 1h-2.5a1 1 0 00-.8.4l-1.9 2.533a1 1 0 01-1.6 0L5.3 11.4a1 1 0 00-.8-.4H2a1 1 0 01-1-1V2a1 1 0 011-1h12zM2 0a2 2 0 00-2 2v8a2 2 0 002 2h2.5a.5.5 0 01.4.2l1.9 2.533a.5.5 0 00.8 0l1.9-2.533a.5.5 0 01.4-.2H14a2 2 0 002-2V2a2 2 0 00-2-2H2z"/>
				<path d="M3 3.5a.5.5 0 01.5-.5h9a.5.5 0 010 1h-9a.5.5 0 01-.5-.5zM3 6a.5.5 0 01.5-.5h9a.5.5 0 010 1h-9A.5.5 0 013 6zm0 2.5a.5.5 0 01.5-.5h5a.5.5 0 010 1h-5a.5.5 0 01-.5-.5z"/>
			</svg>
			Comments
		</button>

		{#if showComments}
			<div class="absolute inset-y-0 right-0 w-72 z-10">
				<GuestCommentPanel shareToken={data.shareToken} />
			</div>
		{/if}
	</div>
{/if}
