<script lang="ts">
	import { onMount } from 'svelte';
	import type { ShareViewerData, ShareViewerStatus } from '$lib/contracts/share-viewer.js';
	import { mapStore } from '$lib/stores/map.svelte.js';
	import MapEditor from '$lib/components/map/MapEditor.svelte';
	import SkeletonLoader from '$lib/components/ui/SkeletonLoader.svelte';
	import ErrorState from '$lib/components/ui/ErrorState.svelte';
	import type { Layer } from '@felt-like-it/shared-types';

	interface Props {
		data: ShareViewerData;
		status: ShareViewerStatus;
	}

	let { data, status }: Props = $props();

	onMount(() => {
		mapStore.loadViewport(data.map.viewport);
		mapStore.setBasemap(data.map.basemap as Parameters<typeof mapStore.setBasemap>[0]);
	});
</script>

{#if status === 'loading'}
	<div class="h-screen bg-surface flex items-center justify-center">
		<SkeletonLoader layout="editor" />
	</div>
{:else if status === 'error'}
	<div class="h-screen bg-surface flex items-center justify-center">
		<ErrorState message="Failed to load embedded map." />
	</div>
{:else}
	<MapEditor
		mapId={data.map.id}
		mapTitle={data.map.title}
		initialLayers={data.layers as Layer[]}
		embed={true}
	/>
{/if}
