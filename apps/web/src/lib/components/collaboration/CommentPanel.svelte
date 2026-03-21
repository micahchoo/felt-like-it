<script lang="ts">
	import SidePanel from '$lib/components/ui/SidePanel.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Textarea from '$lib/components/ui/Textarea.svelte';
	import Check from 'lucide-svelte/icons/check';
	import Trash2 from 'lucide-svelte/icons/trash-2';

	interface Comment {
		id: string;
		mapId: string;
		userId: string;
		body: string;
		parentId: string | null;
		resolved: boolean;
		createdAt: Date;
		updatedAt: Date;
	}

	interface Props {
		comments: Comment[];
		isOwner?: boolean;
		oncreate: (body: string) => void;
		ondelete: (id: string) => void;
		onresolve: (id: string) => void;
	}

	let { comments, isOwner = false, oncreate, ondelete, onresolve }: Props = $props();

	let newBody = $state('');

	function handleAdd() {
		const trimmed = newBody.trim();
		if (!trimmed) return;
		oncreate(trimmed);
		newBody = '';
	}

	function formatDate(d: Date): string {
		return new Date(d).toLocaleString();
	}
</script>

<SidePanel title="Comments" side="right">
	<div class="flex flex-col gap-3">
		{#each comments as comment (comment.id)}
			<div class="bg-surface-high rounded-lg p-3 flex flex-col gap-1">
				<div class="flex items-center justify-between">
					<span class="font-display text-xs text-on-surface">{comment.userId}</span>
					<div class="flex items-center gap-1">
						{#if isOwner && !comment.resolved}
							<IconButton
								icon={Check}
								label="Resolve comment"
								size="sm"
								onclick={() => onresolve(comment.id)}
							/>
						{/if}
						<IconButton
							icon={Trash2}
							label="Delete comment"
							size="sm"
							variant="danger"
							onclick={() => ondelete(comment.id)}
						/>
					</div>
				</div>
				<span class="font-display text-xs text-on-surface-variant">{formatDate(comment.createdAt)}</span>
				<p class="font-body text-sm text-on-surface mt-1">{comment.body}</p>
				{#if comment.resolved}
					<div class="mt-1">
						<Badge variant="primary">Resolved</Badge>
					</div>
				{/if}
			</div>
		{/each}

		{#if comments.length === 0}
			<p class="font-body text-sm text-on-surface-variant text-center py-4">No comments yet.</p>
		{/if}
	</div>

	<div class="mt-4 flex flex-col gap-2 border-t border-white/10 pt-4">
		<Textarea bind:value={newBody} placeholder="Write a comment…" rows={3} />
		<Button variant="primary" onclick={handleAdd} disabled={!newBody.trim()}>Add Comment</Button>
	</div>
</SidePanel>
