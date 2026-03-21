<script lang="ts">
	interface Props {
		min?: number;
		max?: number;
		value?: number;
		step?: number;
		label?: string | undefined;
		onchange?: ((value: number) => void) | undefined;
	}

	let {
		min = 0,
		max = 100,
		value = $bindable(50),
		step = 1,
		label = undefined,
		onchange
	}: Props = $props();

	function handleInput(e: Event) {
		const target = e.target as HTMLInputElement;
		value = Number(target.value);
		onchange?.(value);
	}

	let progress = $derived(((value - min) / (max - min)) * 100);
</script>

<div class="flex flex-col gap-1.5">
	{#if label}
		<div class="flex items-center justify-between">
			<span class="font-display text-xs text-on-surface-variant uppercase tracking-wide">{label}</span>
			<span class="font-display text-xs text-on-surface">{value}</span>
		</div>
	{/if}
	<input
		type="range"
		{min}
		{max}
		{step}
		{value}
		oninput={handleInput}
		class="w-full h-2 rounded-full appearance-none cursor-pointer bg-surface-low
			focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface
			[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4
			[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-thumb]:shadow-sm
			[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full
			[&::-moz-range-thumb]:bg-primary [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:shadow-sm"
		style="background: linear-gradient(to right, var(--color-primary) {progress}%, var(--color-surface-low) {progress}%)"
		aria-label={label}
		aria-valuemin={min}
		aria-valuemax={max}
		aria-valuenow={value}
	/>
</div>
