<script lang="ts">
	import SidePanel from '$lib/components/ui/SidePanel.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import Activity from 'lucide-svelte/icons/activity';

	interface MapEvent {
		id: string;
		mapId: string;
		userId: string;
		action: string;
		details: Record<string, unknown> | null;
		createdAt: Date;
	}

	interface Props {
		events: MapEvent[];
	}

	let { events }: Props = $props();

	function formatDate(d: Date): string {
		return new Date(d).toLocaleString();
	}

	// Map actions to badge variants
	const actionVariant = (action: string): 'default' | 'primary' | 'info' | 'error' => {
		if (action.startsWith('delete')) return 'error';
		if (action.startsWith('create')) return 'primary';
		if (action.startsWith('update') || action.startsWith('edit')) return 'info';
		return 'default';
	};
</script>

<SidePanel title="Activity" side="right">
	<div class="flex flex-col gap-3">
		{#each events as event (event.id)}
			<div class="bg-surface-high rounded-lg p-3 flex gap-3 items-start">
				<div class="mt-0.5 text-on-surface-variant shrink-0">
					<Activity size={16} />
				</div>
				<div class="flex flex-col gap-1 min-w-0 flex-1">
					<div class="flex items-center gap-2 flex-wrap">
						<Badge variant={actionVariant(event.action)}>{event.action}</Badge>
					</div>
					<span class="font-display text-xs text-on-surface-variant">{event.userId}</span>
					<span class="font-display text-xs text-on-surface-variant">{formatDate(event.createdAt)}</span>
				</div>
			</div>
		{/each}

		{#if events.length === 0}
			<p class="font-body text-sm text-on-surface-variant text-center py-4">No activity yet.</p>
		{/if}
	</div>
</SidePanel>
