<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		variant?: 'default' | 'primary' | 'info' | 'error';
		size?: 'sm' | 'md';
		children: Snippet;
	}

	let {
		variant = 'default',
		size = 'sm',
		children
	}: Props = $props();

	const variantClasses: Record<string, string> = {
		default: 'bg-surface-high text-on-surface-variant',
		primary: 'bg-primary-container/20 text-primary',
		info: 'bg-tertiary/20 text-tertiary',
		error: 'bg-error/20 text-error'
	};

	const sizeClasses: Record<string, string> = {
		sm: 'text-[0.65rem] px-2 py-0.5',
		md: 'text-xs px-2.5 py-1'
	};
</script>

<span
	class="inline-flex items-center rounded-full font-display uppercase tracking-wide
		{variantClasses[variant]}
		{sizeClasses[size]}"
>
	{@render children()}
</span>
