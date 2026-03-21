<script lang="ts">
	import type { DashboardData, DashboardActions, DashboardStatus } from '$lib/contracts/dashboard.js';
	import type { Component } from 'svelte';
	import { Plus, Map as MapIconRaw } from 'lucide-svelte/icons';
	import TopBar from '$lib/components/ui/TopBar.svelte';
	import MapCard from '$lib/components/ui/MapCard.svelte';
	import SkeletonLoader from '$lib/components/ui/SkeletonLoader.svelte';
	import ErrorState from '$lib/components/ui/ErrorState.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';

	// TYPE_DEBT: lucide-svelte@0.469 SvelteComponentTyped incompatible with Svelte 5 Component<T> + exactOptionalPropertyTypes
	const MapIcon = MapIconRaw as unknown as Component<{ size?: number; class?: string }>;

	interface Props {
		data: DashboardData;
		actions: DashboardActions;
		status: DashboardStatus;
	}

	let { data, actions, status }: Props = $props();

	function handleOpen(id: string) {
		console.log('[dashboard] open map:', id);
	}
</script>

<div class="min-h-screen bg-surface">
	<!-- TopBar -->
	<TopBar>
		<span class="font-display text-xl font-bold text-primary">FLIT</span>
		<div class="flex items-center gap-4">
			<a href="/settings" class="text-on-surface-variant hover:text-on-surface transition-colors font-display text-sm">Settings</a>
			<a href="/admin" class="text-on-surface-variant hover:text-on-surface transition-colors font-display text-sm">Admin</a>
			<!-- User menu placeholder -->
			<div class="h-8 w-8 rounded-full bg-surface-high flex items-center justify-center cursor-pointer">
				<span class="font-display text-xs text-on-surface-variant">U</span>
			</div>
		</div>
	</TopBar>

	<!-- Main content -->
	<main class="mt-16 p-6">
		{#if status === 'loading'}
			<SkeletonLoader layout="dashboard" />
		{:else if status === 'error'}
			<ErrorState message="Failed to load maps" onretry={actions.onRetry} />
		{:else if status === 'empty'}
			<EmptyState
				icon={MapIcon}
				message="No maps yet"
				description="Create your first map to get started with spatial analysis."
				cta="Create your first map"
				onaction={() => actions.onCreate('New Map')}
			/>
		{:else}
			<!-- My Maps -->
			<section class="mb-10">
				<h2 class="font-display text-lg text-on-surface mb-4">My Maps</h2>
				{#if data.maps.length === 0}
					<EmptyState
						icon={MapIcon}
						message="No maps yet"
						description="Create your first map."
						cta="New Map"
						onaction={() => actions.onCreate('New Map')}
					/>
				{:else}
					<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
						{#each data.maps as map (map.id)}
							<MapCard
								{map}
								onopen={handleOpen}
								onclone={actions.onClone}
								ondelete={actions.onDelete}
							/>
						{/each}
					</div>
				{/if}
			</section>

			<!-- Shared with Me -->
			{#if data.collaboratingMaps.length > 0}
				<section class="mb-10">
					<h2 class="font-display text-lg text-on-surface mb-4">Shared with Me</h2>
					<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
						{#each data.collaboratingMaps as map (map.id)}
							<MapCard
								{map}
								onopen={handleOpen}
								onclone={actions.onClone}
								ondelete={actions.onDelete}
							/>
						{/each}
					</div>
				</section>
			{/if}

			<!-- Templates -->
			{#if data.templates.length > 0}
				<section class="mb-10">
					<h2 class="font-display text-lg text-on-surface mb-4">Templates</h2>
					<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
						{#each data.templates as map (map.id)}
							<MapCard
								{map}
								onopen={handleOpen}
								onclone={actions.onClone}
								ondelete={actions.onDelete}
								templateOverlay={true}
							/>
						{/each}
					</div>
				</section>
			{/if}
		{/if}
	</main>

	<!-- Floating action button -->
	<button
		type="button"
		class="fixed bottom-6 right-6 h-14 w-14 rounded-full signature-gradient flex items-center justify-center shadow-lg cursor-pointer transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface z-40"
		aria-label="Create new map"
		onclick={() => actions.onCreate('New Map')}
	>
		<Plus size={24} class="text-on-primary-container" />
	</button>
</div>
