<script lang="ts">
	import GlassPanel from '$lib/components/ui/GlassPanel.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import Copy from 'lucide-svelte/icons/copy';

	interface Props {
		shareUrl?: string;
		embedCode?: string;
		accessLevel?: 'public' | 'unlisted';
		ongeneratetoken: () => void;
		onaccesschange: (level: string) => void;
	}

	let {
		shareUrl = '',
		embedCode = '',
		accessLevel = 'unlisted',
		ongeneratetoken,
		onaccesschange
	}: Props = $props();

	function copyToClipboard(text: string) {
		navigator.clipboard.writeText(text).catch(() => {});
	}

	function setAccess(level: 'public' | 'unlisted') {
		onaccesschange(level);
	}
</script>

<GlassPanel class="w-full max-w-lg p-6 flex flex-col gap-5">
	<h2 class="font-display text-lg font-semibold text-on-surface">Share Map</h2>

	<!-- Access level -->
	<div class="flex flex-col gap-2">
		<p class="font-display text-xs text-on-surface-variant uppercase tracking-wide">Access Level</p>
		<div class="flex gap-2">
			<Button
				variant={accessLevel === 'public' ? 'primary' : 'secondary'}
				onclick={() => setAccess('public')}
			>
				Public
			</Button>
			<Button
				variant={accessLevel === 'unlisted' ? 'primary' : 'secondary'}
				onclick={() => setAccess('unlisted')}
			>
				Unlisted
			</Button>
		</div>
	</div>

	<!-- Share link -->
	<div class="flex flex-col gap-1">
		<p class="font-display text-xs text-on-surface-variant uppercase tracking-wide">Share Link</p>
		<div class="flex items-center gap-2">
			<div class="flex-1">
				<Input value={shareUrl} disabled />
			</div>
			<IconButton
				icon={Copy}
				label="Copy share link"
				onclick={() => copyToClipboard(shareUrl)}
			/>
		</div>
	</div>

	<!-- Embed code -->
	<div class="flex flex-col gap-1">
		<p class="font-display text-xs text-on-surface-variant uppercase tracking-wide">Embed Code</p>
		<div class="flex items-start gap-2">
			<div class="flex-1">
				<Textarea value={embedCode} disabled rows={3} />
			</div>
			<IconButton
				icon={Copy}
				label="Copy embed code"
				onclick={() => copyToClipboard(embedCode)}
			/>
		</div>
	</div>

	<!-- Generate token -->
	<div class="pt-2 border-t border-white/10">
		<Button variant="secondary" onclick={ongeneratetoken}>Generate New Token</Button>
	</div>
</GlassPanel>
