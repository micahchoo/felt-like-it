<script lang="ts">
	import type { ShareViewerData, ShareViewerStatus } from '$lib/contracts/share-viewer.js';
	import MapCanvas from '$lib/components/map/MapCanvas.svelte';
	import Legend from '$lib/components/map/Legend.svelte';
	import Spinner from '$lib/components/ui/Spinner.svelte';
	import ErrorState from '$lib/components/ui/ErrorState.svelte';

	interface Props {
		data: ShareViewerData;
		status: ShareViewerStatus;
	}

	let { data, status }: Props = $props();

	const legendEntries = $derived(
		data.layers.flatMap((layer) =>
			(layer.style.legend ?? []).map((e) => ({
				label: e.label,
				color: e.color,
				...(e.value != null ? { value: e.value } : {}),
			}))
		)
	);
</script>

<div class="relative w-screen h-screen overflow-hidden bg-surface">
	{#if status === 'loading'}
		<div class="flex items-center justify-center w-full h-full">
			<Spinner size="lg" />
		</div>
	{:else if status === 'error'}
		<ErrorState message="Failed to load embedded map." />
	{:else}
		<!-- Map fills entire viewport — no chrome -->
		<MapCanvas interactionMode="default" />

		<!-- Legend floating bottom-left -->
		<Legend entries={legendEntries} title={data.map.title} />
	{/if}
</div>
