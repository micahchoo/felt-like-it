<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';

	interface AuditEntry {
		id: string;
		action: string;
		userId: string;
		timestamp: Date;
		verified: boolean;
	}

	interface Props {
		entries: AuditEntry[];
	}

	let { entries }: Props = $props();

	const columns = ['Action', 'User', 'Timestamp', 'Verified'];

	function formatDate(d: Date): string {
		return d.toLocaleString(undefined, {
			dateStyle: 'short',
			timeStyle: 'short',
		});
	}

	function truncateId(id: string): string {
		return id.length > 12 ? `${id.slice(0, 8)}…` : id;
	}
</script>

<div class="overflow-x-auto">
	<table class="w-full text-sm">
		<thead>
			<tr>
				{#each columns as col}
					<th
						class="text-left font-display text-xs uppercase tracking-wide text-on-surface-variant px-4 py-3"
					>
						{col}
					</th>
				{/each}
			</tr>
		</thead>
		<tbody>
			{#each entries as entry (entry.id)}
				<tr class="hover:bg-surface-high transition-colors">
					<td class="px-4 py-3 font-display text-xs text-on-surface">{entry.action}</td>
					<td class="px-4 py-3 font-body text-on-surface-variant font-mono text-xs">
						{truncateId(entry.userId)}
					</td>
					<td class="px-4 py-3 font-body text-on-surface-variant text-xs">
						{formatDate(entry.timestamp)}
					</td>
					<td class="px-4 py-3">
						{#if entry.verified}
							<Badge variant="primary">Verified</Badge>
						{:else}
							<Badge variant="error">Failed</Badge>
						{/if}
					</td>
				</tr>
			{:else}
				<tr>
					<td
						colspan={columns.length}
						class="px-4 py-8 text-center font-body text-on-surface-variant"
					>
						No audit log entries.
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
