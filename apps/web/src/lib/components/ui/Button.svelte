<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';

	interface Props extends HTMLButtonAttributes {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'sm' | 'md' | 'lg';
		disabled?: boolean;
		loading?: boolean;
		type?: 'button' | 'submit';
		onclick?: (() => void) | undefined;
		children: Snippet;
	}

	let {
		variant = 'secondary',
		size = 'md',
		disabled = false,
		loading = false,
		type = 'button',
		onclick,
		children,
		...restProps
	}: Props = $props();

	const variantClasses: Record<string, string> = {
		primary: 'signature-gradient text-on-primary-container',
		secondary: 'bg-surface-container text-on-surface',
		ghost: 'bg-transparent text-on-surface hover:bg-surface-high',
		danger: 'bg-error/20 text-error'
	};

	const sizeClasses: Record<string, string> = {
		sm: 'text-xs px-3 py-1.5',
		md: 'text-sm px-4 py-2',
		lg: 'text-base px-6 py-3'
	};
</script>

<button
	{type}
	class="font-display uppercase tracking-wide rounded-md transition-colors
		focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface
		{variantClasses[variant]}
		{sizeClasses[size]}
		{disabled || loading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}"
	disabled={disabled || loading}
	onclick={loading ? undefined : onclick}
	aria-disabled={disabled || loading}
	aria-busy={loading}
	{...restProps}
>
	{#if loading}
		<span aria-hidden="true">...</span>
	{:else}
		{@render children()}
	{/if}
</button>
