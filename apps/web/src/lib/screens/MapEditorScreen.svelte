<script lang="ts">
	import type { MapEditorData, MapEditorActions, MapEditorStatus } from '$lib/contracts/map-editor.js';
	import TopBar from '$lib/components/ui/TopBar.svelte';
	import SidePanel from '$lib/components/ui/SidePanel.svelte';
	import SkeletonLoader from '$lib/components/ui/SkeletonLoader.svelte';
	import ErrorState from '$lib/components/ui/ErrorState.svelte';
	import EmptyState from '$lib/components/ui/EmptyState.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import DataTable from '$lib/components/ui/DataTable.svelte';

	import MapCanvas from '$lib/components/map/MapCanvas.svelte';
	import DrawingToolbar from '$lib/components/map/DrawingToolbar.svelte';
	import BasemapPicker from '$lib/components/map/BasemapPicker.svelte';
	import Legend from '$lib/components/style/Legend.svelte';
	import LayerPanel from '$lib/components/map/LayerPanel.svelte';

	import Share2 from 'lucide-svelte/icons/share-2';
	import Download from 'lucide-svelte/icons/download';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';

	let { data, actions, status }: {
		data: MapEditorData;
		actions: MapEditorActions;
		status: MapEditorStatus;
	} = $props();

	// Local UI state
	let activeTab = $state<'annotations' | 'comments' | 'geoprocessing' | 'measure' | 'activity'>('annotations');
	let dataTableOpen = $state(false);
	let interactionMode = $state('default');
	let activeBasemap = $state('dark-matter');

	// Legend entries derived from layers
	const LAYER_COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fb923c', '#a78bfa', '#34d399'];
	const legendEntries = $derived(
		data.layers.map((layer, i) => ({
			label: layer.name,
			color: LAYER_COLORS[i % LAYER_COLORS.length] ?? '#888888',
		}))
	);

	// DataTable: features from first layer
	const firstLayerId = $derived(data.layers[0]?.id ?? '');
	const firstLayerFeatures = $derived(data.features[firstLayerId] ?? []);
	const tableRows = $derived(
		firstLayerFeatures.map((f) => ({ id: f.id, ...f.properties }))
	);
	const tableColumns = $derived(
		tableRows.length > 0
			? Object.keys(tableRows[0]!).map((key) => ({ key, label: key, sortable: true }))
			: [{ key: 'id', label: 'ID', sortable: false }]
	);

	const TABS: { id: typeof activeTab; label: string }[] = [
		{ id: 'annotations', label: 'Annotations' },
		{ id: 'comments', label: 'Comments' },
		{ id: 'geoprocessing', label: 'Geoprocessing' },
		{ id: 'measure', label: 'Measure' },
		{ id: 'activity', label: 'Activity' },
	];
</script>

{#if status === 'loading'}
	<div class="h-screen bg-surface flex items-center justify-center">
		<SkeletonLoader layout="editor" />
	</div>
{:else if status === 'error'}
	<div class="h-screen bg-surface flex items-center justify-center">
		<ErrorState message="Failed to load map." onretry={actions.onRetry} />
	</div>
{:else if status === 'empty'}
	<div class="h-screen bg-surface flex items-center justify-center">
		<EmptyState
			message="No map found."
			description="This map may have been deleted or you may not have access."
			cta="Go to Dashboard"
			onaction={() => { window.location.href = '/'; }}
		/>
	</div>
{:else}
	<!-- Full editor layout -->
	<div class="h-screen bg-surface flex flex-col overflow-hidden">

		<!-- TopBar: fixed top, h-16 z-50 (handled internally) -->
		<TopBar>
			{#snippet children()}
				<div class="flex items-center justify-between w-full px-4">
					<div class="flex items-center gap-3">
						<a href="/" class="text-on-surface-variant hover:text-on-surface transition-colors font-display text-sm">← Dashboard</a>
						<span class="font-display text-base font-semibold text-on-surface truncate max-w-xs">
							{data.map.title}
						</span>
					</div>
					<div class="flex items-center gap-2">
						<Button variant="ghost" size="sm" onclick={() => console.log('[mock] share')}>
							{#snippet children()}
								<Share2 size={15} class="mr-1.5" />
								Share
							{/snippet}
						</Button>
						<Button variant="secondary" size="sm" onclick={() => console.log('[mock] export')}>
							{#snippet children()}
								<Download size={15} class="mr-1.5" />
								Export
							{/snippet}
						</Button>
					</div>
				</div>
			{/snippet}
		</TopBar>

		<!-- Body: below TopBar -->
		<div class="flex flex-1 mt-16 overflow-hidden">

			<!-- Left: LayerPanel (fixed, inside SidePanel internally) -->
			<LayerPanel
			layers={data.layers}
				ontogglelayer={(id, visible) => actions.onLayerToggle(id, visible)}
				ondeletelayer={(id) => actions.onLayerDelete(id)}
				oneditstyle={(id) => actions.onLayerUpdateStyle(id, {})}
				onopendata={(id) => console.log('[mock] open data', id)}
				onaddlayer={() => actions.onLayerCreate('New Layer')}
				onreorder={(id, newIndex) => actions.onLayerReorder(id, newIndex)}
			/>

			<!-- Center + Right: map area + right panel stacked -->
			<div class="flex flex-1 ml-80 overflow-hidden">

				<!-- Map area: fills remaining space, relative for absolute children -->
				<div class="flex flex-col flex-1 overflow-hidden">
					<div class="relative flex-1 overflow-hidden">
								<MapCanvas interactionMode={interactionMode} />

						<!-- Floating: DrawingToolbar (positions itself absolute top-4 left-4) -->
									<DrawingToolbar
							activeMode={interactionMode}
							onmodechange={(mode) => { interactionMode = mode; }}
						/>

						<!-- Floating: BasemapPicker (positions itself absolute bottom-4 right-4) -->
						<BasemapPicker
							activeBasemap={activeBasemap}
							onselect={(id) => { activeBasemap = id; }}
						/>

						<!-- Floating: Legend (positions itself absolute bottom-4 left-4) -->
									<Legend entries={legendEntries} title="Layers" />
					</div>

					<!-- DataTable: collapsible bottom strip -->
					<div class="border-t border-white/10 bg-surface-well flex flex-col shrink-0"
						style="max-height: 40%;">
						<button
							type="button"
							class="flex items-center gap-2 px-4 py-2 font-display text-sm text-on-surface-variant
								hover:text-on-surface transition-colors w-full text-left"
							onclick={() => { dataTableOpen = !dataTableOpen; }}
						>
							{#if dataTableOpen}
								<ChevronDown size={16} />
							{:else}
								<ChevronUp size={16} />
							{/if}
							Feature Data
							{#if firstLayerId}
								<span class="text-xs text-on-surface-variant/60 ml-1">
									({data.layers[0]?.name ?? ''} · {firstLayerFeatures.length} features)
								</span>
							{/if}
						</button>

						{#if dataTableOpen}
							<div class="flex-1 overflow-auto">
								<DataTable
									columns={tableColumns}
									rows={tableRows}
									searchable={true}
								/>
							</div>
						{/if}
					</div>
				</div>

				<!-- Right SidePanel: tabs for Annotations/Comments/etc -->
				<SidePanel title={TABS.find(t => t.id === activeTab)?.label ?? 'Annotations'} side="right">
					{#snippet children()}
						<!-- Tab headers -->
						<div class="flex gap-1 mb-4 flex-wrap -mx-1">
							{#each TABS as tab}
								<button
									type="button"
									class="px-3 py-1.5 rounded font-display text-xs transition-colors
										{activeTab === tab.id
											? 'bg-primary text-on-primary'
											: 'text-on-surface-variant hover:bg-white/10'}"
									onclick={() => { activeTab = tab.id; }}
								>
									{tab.label}
								</button>
							{/each}
						</div>

						<!-- Tab content (placeholder until components exist) -->
						{#if activeTab === 'annotations'}
							<p class="font-body text-sm text-on-surface-variant">
								Annotations panel coming soon.
							</p>
						{:else if activeTab === 'comments'}
							<p class="font-body text-sm text-on-surface-variant">
								Comments panel coming soon.
							</p>
						{:else if activeTab === 'geoprocessing'}
							<p class="font-body text-sm text-on-surface-variant">
								Geoprocessing panel coming soon.
							</p>
						{:else if activeTab === 'measure'}
							<p class="font-body text-sm text-on-surface-variant">
								Measurement panel coming soon.
							</p>
						{:else if activeTab === 'activity'}
							<p class="font-body text-sm text-on-surface-variant">
								Activity feed coming soon.
							</p>
						{/if}
					{/snippet}
				</SidePanel>
			</div>
		</div>
	</div>
{/if}
