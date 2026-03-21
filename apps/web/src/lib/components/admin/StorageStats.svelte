<script lang="ts">
	import GlassPanel from '$lib/components/ui/GlassPanel.svelte';
	import ProgressBar from '$lib/components/ui/ProgressBar.svelte';

	interface Props {
		stats: {
			uploadVolume: number;
			maxVolume: number;
			featureCount: number;
			mapCount: number;
		};
	}

	let { stats }: Props = $props();

	const uploadPercent = $derived(
		stats.maxVolume > 0 ? (stats.uploadVolume / stats.maxVolume) * 100 : 0
	);

	function formatBytes(bytes: number): string {
		if (bytes >= 1_073_741_824) return `${(bytes / 1_073_741_824).toFixed(1)} GiB`;
		if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MiB`;
		if (bytes >= 1_024) return `${(bytes / 1_024).toFixed(1)} KiB`;
		return `${bytes} B`;
	}
</script>

<div class="grid grid-cols-2 gap-4">
	<GlassPanel class="p-4 flex flex-col gap-3">
		<span class="font-display text-xs uppercase tracking-wide text-on-surface-variant">
			Upload Volume
		</span>
		<ProgressBar value={uploadPercent} label="{formatBytes(stats.uploadVolume)} / {formatBytes(stats.maxVolume)}" />
	</GlassPanel>

	<GlassPanel class="p-4 flex flex-col gap-2">
		<span class="font-display text-xs uppercase tracking-wide text-on-surface-variant">
			Features
		</span>
		<span class="font-display text-3xl text-primary">
			{stats.featureCount.toLocaleString()}
		</span>
	</GlassPanel>

	<GlassPanel class="p-4 flex flex-col gap-2">
		<span class="font-display text-xs uppercase tracking-wide text-on-surface-variant">
			Maps
		</span>
		<span class="font-display text-3xl text-primary">
			{stats.mapCount.toLocaleString()}
		</span>
	</GlassPanel>
</div>
