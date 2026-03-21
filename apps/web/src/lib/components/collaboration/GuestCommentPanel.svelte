<script lang="ts">
	import GlassPanel from '$lib/components/ui/GlassPanel.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import MessageSquare from 'lucide-svelte/icons/message-square';

	interface Props {
		oncreate: (name: string, body: string) => void;
	}

	let { oncreate }: Props = $props();

	let open = $state(false);
	let name = $state('');
	let body = $state('');

	function toggle() {
		open = !open;
	}

	function handleSubmit() {
		const trimmedName = name.trim();
		const trimmedBody = body.trim();
		if (!trimmedName || !trimmedBody) return;
		oncreate(trimmedName, trimmedBody);
		name = '';
		body = '';
		open = false;
	}
</script>

<div class="fixed bottom-20 right-4 z-30 flex flex-col items-end gap-2">
	{#if open}
		<GlassPanel class="w-72 p-4 flex flex-col gap-3">
			<p class="font-display text-sm font-semibold text-on-surface">Leave a Comment</p>
			<div class="flex flex-col gap-1">
				<label for="guest-name" class="font-display text-xs text-on-surface-variant">Your Name</label>
				<Input id="guest-name" bind:value={name} placeholder="Name" />
			</div>
			<Textarea bind:value={body} placeholder="Write your comment…" rows={3} />
			<Button variant="primary" onclick={handleSubmit} disabled={!name.trim() || !body.trim()}>
				Comment
			</Button>
		</GlassPanel>
	{/if}

	<IconButton
		icon={MessageSquare}
		label={open ? 'Hide comment panel' : 'Open comment panel'}
		active={open}
		onclick={toggle}
	/>
</div>
