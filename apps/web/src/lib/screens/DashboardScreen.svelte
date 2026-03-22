<script lang="ts">
	import type { DashboardData, DashboardActions, DashboardStatus } from '$lib/contracts/dashboard.js';
	import type { Component } from 'svelte';
	import { Plus, Map as MapIconRaw, Search, Edit2, Eye } from 'lucide-svelte/icons';
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

	let activeTab = $state<'all' | 'recent' | 'shared' | 'templates'>('all');
	let searchQuery = $state('');
	let creatingMap = $state(false);

	async function handleCreate(title: string) {
		if (creatingMap) return;
		creatingMap = true;
		try {
			await handleCreate(title);
		} finally {
			creatingMap = false;
		}
	}

	function handleOpen(id: string) {
		window.location.href = `/map/${id}`;
	}
</script>

<div class="min-h-screen bg-surface flex flex-col">
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
	<main class="mt-16 flex-1 flex flex-col">
		<!-- Search bar -->
		<div class="px-6 pt-6 pb-4">
			<div class="relative">
				<Search size={16} class="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
				<input
					type="search"
					placeholder="Search precision maps..."
					bind:value={searchQuery}
					class="w-full bg-surface-container border border-white/5 rounded-xl pl-9 pr-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:border-primary/30 transition-colors"
				/>
			</div>
		</div>

		<!-- Tab bar -->
		<div class="px-6 pb-5 flex items-center gap-1">
			{#each [['all', 'All Maps'], ['recent', 'Recent'], ['shared', 'Shared'], ['templates', 'Templates']] as [key, label]}
				<button
					type="button"
					onclick={() => activeTab = key as typeof activeTab}
					class={activeTab === key
						? 'bg-amber-500/10 text-amber-500 border border-amber-500/20 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors'
						: 'text-on-surface-variant hover:text-amber-400 px-3 py-1.5 text-sm transition-colors'}
				>
					{label}
				</button>
			{/each}
		</div>

		<!-- Content area -->
		<div class="px-6 flex-1 pb-6">
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
					onaction={() => handleCreate('New Map')}
				/>
			{:else}
				<!-- Owned Maps section -->
				{#if activeTab === 'all' || activeTab === 'recent'}
					<section class="mb-8">
						<!-- Section header -->
						<div class="flex items-center gap-3 mb-4">
							<span class="text-[10px] font-bold text-primary uppercase tracking-widest">Owned Maps</span>
							<span class="text-[9px] text-on-surface-variant uppercase tracking-widest">{data.maps.length} elements</span>
						</div>

						{#if data.maps.length === 0}
							<EmptyState
								icon={MapIcon}
								message="No maps yet"
								description="Create your first map."
								cta="New Map"
								onaction={() => handleCreate('New Map')}
							/>
						{:else}
							<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
								{#each data.maps as map (map.id)}
									<div class="bg-surface-container-low rounded-xl border border-white/5 hover:border-primary/20 transition-all overflow-hidden">
										<!-- Thumbnail placeholder -->
										<div class="h-28 bg-surface-container flex items-center justify-center">
											<MapIcon size={28} class="text-on-surface-variant/30" />
										</div>
										<!-- Card body -->
										<div class="p-3">
											<div class="flex items-start justify-between gap-2 mb-1">
												<span class="text-sm font-semibold text-on-surface leading-tight">{map.title}</span>
												<span class="shrink-0 bg-primary-container text-on-primary-container text-[9px] font-bold uppercase rounded-full px-2 py-0.5">Owner</span>
											</div>
											<p class="text-xs text-on-surface-variant mb-3">Last update: {new Date(map.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
											<div class="flex items-center gap-1.5">
												<button
													type="button"
													onclick={() => handleOpen(map.id)}
													class="flex items-center gap-1 bg-surface-container rounded-lg px-2 py-1 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
													aria-label="Edit map"
												>
													<Edit2 size={11} />
													<span>Edit</span>
												</button>
												<button
													type="button"
													onclick={() => handleOpen(map.id)}
													class="flex items-center gap-1 bg-surface-container rounded-lg px-2 py-1 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
													aria-label="View map"
												>
													<Eye size={11} />
													<span>View</span>
												</button>
											</div>
										</div>
									</div>
								{/each}
							</div>
						{/if}
					</section>
				{/if}

				<!-- Shared with Me section -->
				{#if (activeTab === 'all' || activeTab === 'shared') && data.collaboratingMaps.length > 0}
					<section class="mb-8">
						<div class="flex items-center gap-3 mb-4">
							<span class="text-[10px] font-bold text-primary uppercase tracking-widest">Shared with Me</span>
							<span class="text-[9px] text-on-surface-variant uppercase tracking-widest">{data.collaboratingMaps.length} elements</span>
						</div>
						<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
							{#each data.collaboratingMaps as map (map.id)}
								<div class="bg-surface-container-low rounded-xl border border-white/5 hover:border-primary/20 transition-all overflow-hidden">
									<div class="h-28 bg-surface-container flex items-center justify-center">
										<MapIcon size={28} class="text-on-surface-variant/30" />
									</div>
									<div class="p-3">
										<div class="flex items-start justify-between gap-2 mb-1">
											<span class="text-sm font-semibold text-on-surface leading-tight">{map.title}</span>
											<span class="shrink-0 bg-surface-container text-on-surface-variant text-[9px] font-bold uppercase rounded-full px-2 py-0.5">Shared</span>
										</div>
										<p class="text-xs text-on-surface-variant mb-3">Last update: {new Date(map.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
										<div class="flex items-center gap-1.5">
											<button
												type="button"
												onclick={() => handleOpen(map.id)}
												class="flex items-center gap-1 bg-surface-container rounded-lg px-2 py-1 text-xs text-on-surface-variant hover:text-on-surface transition-colors"
												aria-label="View map"
											>
												<Eye size={11} />
												<span>View</span>
											</button>
										</div>
									</div>
								</div>
							{/each}
						</div>
					</section>
				{/if}

				<!-- Templates section -->
				{#if activeTab === 'all' || activeTab === 'templates'}
					<section class="mb-8">
						<div class="flex items-center justify-between mb-4">
							<div class="flex items-center gap-3">
								<span class="text-[10px] font-bold text-primary uppercase tracking-widest">Templates</span>
								{#if data.templates.length > 0}
									<span class="text-[9px] text-on-surface-variant uppercase tracking-widest">{data.templates.length} elements</span>
								{/if}
							</div>
							<button
								type="button"
								onclick={() => handleCreate('New Template')}
								class="flex items-center gap-1.5 bg-surface-container rounded-lg px-2.5 py-1.5 text-xs text-on-surface-variant hover:text-on-surface transition-colors border border-white/5"
							>
								<Plus size={12} />
								<span>Create</span>
							</button>
						</div>
						{#if data.templates.length > 0}
							<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
								{#each data.templates as map (map.id)}
									<div class="bg-surface-container-low rounded-xl border border-white/5 hover:border-primary/20 transition-all overflow-hidden">
										<div class="h-28 bg-surface-container flex items-center justify-center">
											<MapIcon size={28} class="text-on-surface-variant/30" />
										</div>
										<div class="p-3">
											<div class="flex items-start justify-between gap-2 mb-1">
												<span class="text-sm font-semibold text-on-surface leading-tight">{map.title}</span>
												<span class="shrink-0 bg-surface-container text-on-surface-variant text-[9px] font-bold uppercase rounded-full px-2 py-0.5">Template</span>
											</div>
											<p class="text-xs text-on-surface-variant mb-3">Last update: {new Date(map.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
											<button
												type="button"
												onclick={() => actions.onClone(map.id)}
												class="flex items-center gap-1 bg-primary text-on-primary font-bold rounded-lg px-2.5 py-1 text-xs transition-colors hover:opacity-90"
											>
												<Plus size={11} />
												<span>Use Template</span>
											</button>
										</div>
									</div>
								{/each}
							</div>
						{:else}
							<div class="bg-surface-container-low rounded-xl border border-white/5 border-dashed p-8 flex flex-col items-center gap-3 text-center">
								<span class="text-xs text-on-surface-variant">No templates yet. Create one from an existing map.</span>
							</div>
						{/if}
					</section>
				{/if}
			{/if}
		</div>
	</main>


	<!-- Floating action button -->
	<button
		type="button"
		disabled={creatingMap}
		class="fixed bottom-20 right-6 h-14 w-14 rounded-full signature-gradient flex items-center justify-center shadow-lg cursor-pointer transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface z-40
			{creatingMap ? 'opacity-50 cursor-not-allowed' : ''}"
		aria-label="Create new map"
		onclick={() => handleCreate('New Map')}
	>
		{#if creatingMap}
			<div class="h-5 w-5 border-2 border-on-primary-container/30 border-t-on-primary-container rounded-full animate-spin"></div>
		{:else}
			<Plus size={24} class="text-on-primary-container" />
		{/if}
	</button>
</div>
