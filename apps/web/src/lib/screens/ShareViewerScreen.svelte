<script lang="ts">
	import type { ShareViewerData, ShareViewerActions, ShareViewerStatus } from '$lib/contracts/share-viewer.js';
	import MapCanvas from '$lib/components/map/MapCanvas.svelte';
	import Legend from '$lib/components/style/Legend.svelte';
	import GuestCommentPanel from '$lib/components/collaboration/GuestCommentPanel.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import SkeletonLoader from '$lib/components/ui/SkeletonLoader.svelte';
	import ErrorState from '$lib/components/ui/ErrorState.svelte';
	import Code from 'lucide-svelte/icons/code';

	interface Props {
		data: ShareViewerData;
		actions: ShareViewerActions;
		status: ShareViewerStatus;
	}

	let { data, actions, status }: Props = $props();

	const legendEntries = $derived(
		data.layers.flatMap((layer) =>
			(layer.style.legend ?? []).map((e) => ({
				label: e.label,
				color: e.color,
				...(e.value != null ? { value: e.value } : {}),
			}))
		)
	);

	function handleGuestComment(name: string, body: string) {
		actions.onGuestComment(name, body);
	}

	function copyEmbedCode() {
		const embedUrl = `${window.location.origin}/embed/${data.shareToken}`;
		const code = `<iframe src="${embedUrl}" width="800" height="600" frameborder="0" allowfullscreen></iframe>`;
		navigator.clipboard.writeText(code).catch(() => {});
	}
</script>

<div class="relative w-screen h-screen overflow-hidden bg-surface">
	{#if status === 'loading'}
		<SkeletonLoader layout="editor" />
	{:else if status === 'error'}
		<ErrorState message="Failed to load shared map." onretry={actions.onRetry} />
	{:else}
		<!-- Map fills viewport -->
		<MapCanvas interactionMode="default" />

		<!-- Legend floating bottom-left -->
		<Legend entries={legendEntries} title={data.map.title} />

		<!-- Embed copy button floating top-right -->
		<div class="absolute top-4 right-4 z-20">
			<IconButton icon={Code} label="Copy embed code" onclick={copyEmbedCode} />
		</div>

		<!-- Guest comment panel floating bottom-right -->
		<GuestCommentPanel oncreate={handleGuestComment} />
	{/if}
</div>
