<script lang="ts">
	import { fade } from 'svelte/transition';
	import Button from './Button.svelte';

	interface Props {
		open?: boolean;
		title: string;
		message: string;
		confirmLabel?: string;
		variant?: 'primary' | 'danger';
		onconfirm: () => void;
		oncancel: () => void;
	}

	let {
		open = false,
		title,
		message,
		confirmLabel = 'Confirm',
		variant = 'primary',
		onconfirm,
		oncancel
	}: Props = $props();

	let dialogEl: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (open && dialogEl) {
			const focusable = dialogEl.querySelector<HTMLElement>('button');
			focusable?.focus();
		}
	});

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			oncancel();
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
		transition:fade={{ duration: 150 }}
		{onkeydown}
		role="dialog"
		aria-modal="true"
		aria-labelledby="confirm-dialog-title"
		tabindex="-1"
	>
		<div bind:this={dialogEl} class="glass-panel tonal-elevation max-w-md w-full mx-4 rounded-lg p-6">
			<h2 id="confirm-dialog-title" class="font-display text-lg font-semibold text-on-surface">
				{title}
			</h2>
			<p class="font-body text-sm text-on-surface-variant mt-2">
				{message}
			</p>
			<div class="flex justify-end gap-3 mt-6">
				<Button variant="ghost" onclick={oncancel}>Cancel</Button>
				<Button variant={variant === 'danger' ? 'danger' : 'primary'} onclick={onconfirm}>
					{confirmLabel}
				</Button>
			</div>
		</div>
	</div>
{/if}
