<script lang="ts">
	import Search from 'lucide-svelte/icons/search';
	import X from 'lucide-svelte/icons/x';

	interface Props {
		value?: string;
		placeholder?: string;
		onchange?: ((value: string) => void) | undefined;
	}

	let {
		value = $bindable(''),
		placeholder = 'Search...',
		onchange
	}: Props = $props();

	let debounceTimer: ReturnType<typeof setTimeout> | undefined;

	$effect(() => {
		const current = value;
		if (onchange) {
			clearTimeout(debounceTimer);
			debounceTimer = setTimeout(() => {
				onchange(current);
			}, 300);
		}
		return () => clearTimeout(debounceTimer);
	});
</script>

<div class="relative">
	<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant" />
	<input
		type="text"
		bind:value
		{placeholder}
		class="font-body bg-surface-low text-on-surface rounded-md pl-9 pr-8 py-2 text-sm w-full
			border-b-2 border-transparent transition-colors
			placeholder:text-on-surface-variant/50
			focus:border-primary focus:outline-none"
	/>
	{#if value}
		<button
			type="button"
			class="absolute right-2 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface cursor-pointer"
			onclick={() => (value = '')}
			aria-label="Clear search"
		>
			<X size={14} />
		</button>
	{/if}
</div>
