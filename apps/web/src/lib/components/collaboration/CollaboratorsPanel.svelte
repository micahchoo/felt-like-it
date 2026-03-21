<script lang="ts">
	import SidePanel from '$lib/components/ui/SidePanel.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import IconButton from '$lib/components/ui/IconButton.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import X from 'lucide-svelte/icons/x';

	interface Collaborator {
		userId: string;
		mapId: string;
		role: 'viewer' | 'commenter' | 'editor';
		user: { id: string; email: string; name: string };
	}

	interface Props {
		collaborators: Collaborator[];
		oninvite: (email: string, role: string) => void;
		onremove: (userId: string) => void;
	}

	let { collaborators, oninvite, onremove }: Props = $props();

	let inviteEmail = $state('');
	let inviteRole = $state('viewer');

	const roleOptions = [
		{ value: 'viewer', label: 'Viewer' },
		{ value: 'commenter', label: 'Commenter' },
		{ value: 'editor', label: 'Editor' }
	];

	function roleBadgeVariant(role: string): 'default' | 'primary' | 'info' | 'error' {
		if (role === 'editor') return 'primary';
		if (role === 'commenter') return 'info';
		return 'default';
	}

	function handleInvite() {
		const trimmed = inviteEmail.trim();
		if (!trimmed) return;
		oninvite(trimmed, inviteRole);
		inviteEmail = '';
		inviteRole = 'viewer';
	}
</script>

<SidePanel title="Collaborators" side="right">
	<div class="flex flex-col gap-4">
		<!-- Invite form -->
		<div class="flex flex-col gap-2 pb-4 border-b border-white/5">
			<p class="font-display text-xs text-on-surface-variant uppercase tracking-wide">Invite</p>
			<Input bind:value={inviteEmail} placeholder="Email address" type="email" />
			<Select options={roleOptions} bind:value={inviteRole} />
			<Button variant="primary" onclick={handleInvite} disabled={!inviteEmail.trim()}>
				Invite
			</Button>
		</div>

		<!-- Collaborator list -->
		<div class="flex flex-col gap-2">
			{#each collaborators as collab (collab.userId)}
				<div class="bg-surface-high rounded-lg px-3 py-2 flex items-center justify-between gap-2">
					<div class="flex flex-col flex-1 min-w-0">
						<span class="font-display text-sm text-on-surface truncate">{collab.user.name}</span>
						<span class="font-body text-xs text-on-surface-variant truncate">{collab.user.email}</span>
					</div>
					<Badge variant={roleBadgeVariant(collab.role)}>{collab.role}</Badge>
					<IconButton
						icon={X}
						label="Remove collaborator"
						size="sm"
						onclick={() => onremove(collab.userId)}
					/>
				</div>
			{/each}

			{#if collaborators.length === 0}
				<p class="font-body text-sm text-on-surface-variant text-center py-4">No collaborators yet.</p>
			{/if}
		</div>
	</div>
</SidePanel>
