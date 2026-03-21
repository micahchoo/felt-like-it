<script lang="ts">
	import DataTable from '$lib/components/ui/DataTable.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import SearchInput from '$lib/components/ui/SearchInput.svelte';

	interface UserRow {
		id: string;
		name: string;
		email: string;
		isAdmin: boolean;
		disabledAt: Date | null;
	}

	interface Props {
		users: UserRow[];
		ondisable: (id: string) => void;
		onenable: (id: string) => void;
	}

	let { users, ondisable, onenable }: Props = $props();

	let searchQuery = $state('');

	const filteredUsers = $derived(
		searchQuery.trim()
			? users.filter(
					(u) =>
						u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
						u.email.toLowerCase().includes(searchQuery.toLowerCase())
				)
			: users
	);

	const columns = [
		{ key: 'name', label: 'Name', sortable: true },
		{ key: 'email', label: 'Email', sortable: true },
		{ key: 'role', label: 'Role' },
		{ key: 'status', label: 'Status' },
		{ key: 'actions', label: 'Actions' },
	];
</script>

<div class="flex flex-col gap-4">
	<SearchInput
		bind:value={searchQuery}
		placeholder="Search users..."
	/>

	<div class="overflow-x-auto">
		<table class="w-full text-sm">
			<thead>
				<tr>
					{#each columns as col}
						<th
							class="text-left font-display text-xs uppercase tracking-wide text-on-surface-variant px-4 py-3"
						>
							{col.label}
						</th>
					{/each}
				</tr>
			</thead>
			<tbody>
				{#each filteredUsers as user (user.id)}
					<tr class="hover:bg-surface-high transition-colors">
						<td class="px-4 py-3 font-body text-on-surface">{user.name}</td>
						<td class="px-4 py-3 font-body text-on-surface-variant">{user.email}</td>
						<td class="px-4 py-3">
							{#if user.isAdmin}
								<Badge variant="primary">Admin</Badge>
							{:else}
								<Badge variant="default">User</Badge>
							{/if}
						</td>
						<td class="px-4 py-3">
							{#if user.disabledAt}
								<Badge variant="error">Disabled</Badge>
							{:else}
								<Badge variant="info">Active</Badge>
							{/if}
						</td>
						<td class="px-4 py-3">
							{#if user.disabledAt}
								<Button
									variant="ghost"
									size="sm"
									onclick={() => onenable(user.id)}
								>
									Enable
								</Button>
							{:else}
								<Button
									variant="danger"
									size="sm"
									onclick={() => ondisable(user.id)}
								>
									Disable
								</Button>
							{/if}
						</td>
					</tr>
				{:else}
					<tr>
						<td
							colspan={columns.length}
							class="px-4 py-8 text-center font-body text-on-surface-variant"
						>
							No users found.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
