<script lang="ts">
	import { AlertTriangle } from 'lucide-svelte';
	import Button from './Button.svelte';

	interface Props {
		message?: string;
		onretry?: () => void;
	}

	let { message = 'Something went wrong', onretry }: Props = $props();
</script>

<div class="flex flex-col items-center justify-center p-12 text-center">
	<AlertTriangle size={48} class="text-error mb-4" />
	<h3 class="font-display text-xl font-semibold text-error">{message}</h3>
	{#if onretry}
		<div class="mt-6">
			<Button variant="secondary" onclick={onretry}>Retry</Button>
		</div>
	{/if}
</div>
