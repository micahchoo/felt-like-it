<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends HTMLInputAttributes {
		type?: string;
		value?: string;
		placeholder?: string;
		error?: string | undefined;
		disabled?: boolean;
		id?: string | undefined;
	}

	let {
		type = 'text',
		value = $bindable(''),
		placeholder = '',
		error = undefined,
		disabled = false,
		id = undefined,
		...restProps
	}: Props = $props();
</script>

<div class="flex flex-col gap-1">
	<input
		{type}
		bind:value
		{placeholder}
		{disabled}
		{id}
		{...restProps}
		class="font-body bg-surface-low text-on-surface rounded-md px-3 py-2 text-sm
			border-b-2 border-transparent transition-colors
			placeholder:text-on-surface-variant/50
			focus:border-b-2 focus:border-primary focus:outline-none
			focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface
			{error ? 'border-error' : ''}
			{disabled ? 'opacity-50 cursor-not-allowed' : ''}"
		aria-invalid={error ? 'true' : undefined}
		aria-describedby={error && id ? `${id}-error` : undefined}
	/>
	{#if error}
		<p
			class="text-error text-xs font-body"
			id={id ? `${id}-error` : undefined}
			role="alert"
		>
			{error}
		</p>
	{/if}
</div>
