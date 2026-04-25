<script lang="ts">
	import ChevronDown from 'lucide-svelte/icons/chevron-down';

	interface Props {
		options: { value: string; label: string }[];
		value?: string;
		placeholder?: string;
		disabled?: boolean;
		onchange?: ((value: string) => void) | undefined;
	}

	let {
		options,
		value = $bindable(''),
		placeholder = 'Select...',
		disabled = false,
		onchange
	}: Props = $props();

	function handleChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		value = target.value;
		onchange?.(value);
	}
</script>

<div class="relative">
	<select
		bind:value
		onchange={handleChange}
		{disabled}
		class="font-body bg-surface-low text-on-surface rounded-md px-3 py-2 pr-10 text-sm
			w-full appearance-none
			border-b-2 border-transparent transition-colors
			focus:border-b-2 focus:border-primary focus:outline-none
			focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface
			{disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}"
		aria-label={placeholder}
	>
		{#if placeholder}
			<option value="" disabled hidden>{placeholder}</option>
		{/if}
		{#each options as opt (opt.value)}
			<option value={opt.value}>{opt.label}</option>
		{/each}
	</select>
	<div class="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 text-on-surface-variant">
		<ChevronDown size={16} />
	</div>
</div>
