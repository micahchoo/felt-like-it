<script lang="ts">
	import type { Component } from 'svelte';
	import Button from './Button.svelte';

	interface Props {
		icon?: Component<{ size?: number; class?: string }>;
		message: string;
		description?: string;
		cta?: string;
		onaction?: () => void;
	}

	let { icon, message, description, cta, onaction }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center p-12 text-center">
	{#if icon}
		{@const Icon = icon}
		<Icon size={48} class="text-on-surface-variant opacity-50 mb-4" />
	{/if}
	<h3 class="font-display text-xl font-semibold text-on-surface">{message}</h3>
	{#if description}
		<p class="font-body text-sm text-on-surface-variant mt-2 max-w-md">{description}</p>
	{/if}
	{#if cta && onaction}
		<div class="mt-6">
			<Button variant="primary" onclick={onaction}>{cta}</Button>
		</div>
	{/if}
</div>
