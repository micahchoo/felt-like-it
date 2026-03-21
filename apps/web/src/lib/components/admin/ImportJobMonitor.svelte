<script lang="ts">
	import Badge from '$lib/components/ui/Badge.svelte';
	import ProgressBar from '$lib/components/ui/ProgressBar.svelte';

	interface ImportJobRow {
		id: string;
		fileName: string;
		status: string;
		progress: number;
		createdAt: Date;
	}

	interface Props {
		jobs: ImportJobRow[];
	}

	let { jobs }: Props = $props();

	const columns = ['File', 'Status', 'Progress', 'Started'];

	type BadgeVariant = 'default' | 'primary' | 'info' | 'error';

	function statusVariant(status: string): BadgeVariant {
		switch (status) {
			case 'done':
			case 'completed':
				return 'primary';
			case 'failed':
				return 'error';
			case 'processing':
			case 'running':
				return 'info';
			default:
				return 'default';
		}
	}

	function formatDate(d: Date): string {
		return d.toLocaleString(undefined, {
			dateStyle: 'short',
			timeStyle: 'short',
		});
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
			{#each jobs as job (job.id)}
				<tr class="hover:bg-surface-high transition-colors">
					<td class="px-4 py-3 font-body text-on-surface max-w-xs truncate">
						{job.fileName}
					</td>
					<td class="px-4 py-3">
						<Badge variant={statusVariant(job.status)}>
							{job.status}
						</Badge>
					</td>
					<td class="px-4 py-3 min-w-32">
						<ProgressBar value={job.progress} />
					</td>
					<td class="px-4 py-3 font-body text-on-surface-variant text-xs">
						{formatDate(job.createdAt)}
					</td>
				</tr>
			{:else}
				<tr>
					<td
						colspan={columns.length}
						class="px-4 py-8 text-center font-body text-on-surface-variant"
					>
						No import jobs.
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
