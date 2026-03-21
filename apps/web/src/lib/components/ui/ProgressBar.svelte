<script lang="ts">
	interface Props {
		value: number;
		label?: string;
		variant?: 'primary' | 'info';
	}

	let { value, label, variant = 'primary' }: Props = $props();

	const fillClass = $derived(variant === 'info' ? 'bg-tertiary' : 'bg-primary');
	const clampedValue = $derived(Math.max(0, Math.min(100, value)));
</script>

<div class="flex flex-col gap-1">
	{#if label}
		<div class="flex items-center justify-between">
			<span class="font-display text-xs text-on-surface-variant">{label}</span>
			<span class="font-display text-xs text-on-surface">{Math.round(clampedValue)}%</span>
		</div>
	{:else}
		<div class="flex justify-end">
			<span class="font-display text-xs text-on-surface">{Math.round(clampedValue)}%</span>
		</div>
	{/if}
	<div class="bg-surface-low rounded-full h-2" role="progressbar" aria-valuenow={clampedValue} aria-valuemin={0} aria-valuemax={100}>
		<div
			class="h-2 rounded-full transition-[width] duration-300 ease-out {fillClass}"
			style="width: {clampedValue}%"
		></div>
	</div>
</div>
