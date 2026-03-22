<script lang="ts">
	import { onMount } from 'svelte';
	import type { MapEditorData, MapEditorActions, MapEditorStatus } from '$lib/contracts/map-editor.js';
	import { mapStore } from '$lib/stores/map.svelte.js';
	import MapEditor from '$lib/components/map/MapEditor.svelte';
	import SkeletonLoader from '$lib/components/ui/SkeletonLoader.svelte';
	import ErrorState from '$lib/components/ui/ErrorState.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import type { Layer } from '@felt-like-it/shared-types';

	interface Props {
		data: MapEditorData;
		actions: MapEditorActions;
		status: MapEditorStatus;
	}

	let { data, actions, status }: Props = $props();

	onMount(() => {
		const local = mapStore.loadViewportLocally(data.map.id);
		mapStore.loadViewport(local ?? data.map.viewport);
		mapStore.setBasemap(data.map.basemap as Parameters<typeof mapStore.setBasemap>[0]);
	});
</script>

{#if status === 'loading'}
	<div class="h-screen bg-surface flex items-center justify-center">
		<SkeletonLoader layout="editor" />
	</div>
{:else if status === 'error'}
	<div class="h-screen bg-surface flex items-center justify-center">
		<ErrorState message="Failed to load map." onretry={actions.onRetry} />
	</div>
{:else if status === 'empty'}
	<div class="h-screen bg-surface flex items-center justify-center">
		<EmptyState
			message="No map found."
			description="This map may have been deleted or you may not have access."
			cta="Go to Dashboard"
			onaction={() => { window.location.href = '/dashboard'; }}
		/>
	</div>
{:else}
	<MapEditor
		mapId={data.map.id}
		mapTitle={data.map.title}
		initialLayers={data.layers as Layer[]}
		userId={data.userId}
		readonly={data.readonly}
		isOwner={data.isOwner}
		userRole={data.userRole}
	/>
{/if}
