<script lang="ts">
	import type { MapRecord } from '@felt-like-it/shared-types';
	import { MoreVertical, Copy, Trash2 } from 'lucide-svelte/icons';
	import GlassPanel from './GlassPanel.svelte';
	import IconButton from './IconButton.svelte';

	interface Props {
		map: MapRecord;
		onopen: (id: string) => void;
		onclone: (id: string) => void;
		ondelete: (id: string) => void;
		templateOverlay?: boolean;
	}

	let { map, onopen, onclone, ondelete, templateOverlay = false }: Props = $props();

	let menuOpen = $state(false);

	function toggleMenu() {
		menuOpen = !menuOpen;
	}

	function handleClone(e: MouseEvent) {
		e.stopPropagation();
		menuOpen = false;
		onclone(map.id);
	}

	function handleDelete(e: MouseEvent) {
		e.stopPropagation();
		menuOpen = false;
		ondelete(map.id);
	}

	function handleCardClick() {
		onopen(map.id);
	}

	function formatDate(date: Date): string {
		return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(
			new Date(date)
		);
	}

	function closeMenu(e: MouseEvent) {
		if (menuOpen) {
			menuOpen = false;
		}
	}
</script>

<svelte:window onclick={closeMenu} />

<GlassPanel class="group relative cursor-pointer hover:bg-surface-high/50 transition-all overflow-hidden">
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div onclick={handleCardClick} class="flex flex-col h-full">
		<!-- Thumbnail -->
		<div class="map-pattern w-full h-32 relative shrink-0">
			{#if templateOverlay}
				<div class="absolute inset-0 flex items-end justify-start p-2 bg-gradient-to-t from-surface/80 to-transparent">
					<span class="font-display text-xs text-primary uppercase tracking-wide">Template</span>
				</div>
			{/if}
		</div>

		<!-- Content -->
		<div class="p-3 flex flex-col gap-1 flex-1">
			<h3 class="font-display text-sm font-semibold text-on-surface leading-tight line-clamp-1">
				{map.title}
			</h3>

			{#if map.description}
				<p class="font-body text-xs text-on-surface-variant line-clamp-2 leading-relaxed">
					{map.description}
				</p>
			{/if}

			<!-- Metadata -->
			<div class="flex items-center gap-3 mt-auto pt-2">
				<span class="font-display text-xs text-on-surface-variant">
					{formatDate(map.createdAt)}
				</span>
				{#if map.layerCount != null}
					<span class="font-display text-xs text-on-surface-variant">
						{map.layerCount} {map.layerCount === 1 ? 'layer' : 'layers'}
					</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Action menu button -->
	<div class="absolute top-2 right-2">
		<IconButton
			icon={MoreVertical}
			label="Map actions"
			size="sm"
			variant="ghost"
			onclick={toggleMenu}
		/>

		{#if menuOpen}
			<div class="absolute right-0 top-full mt-1 z-10 glass-panel tonal-elevation rounded-md overflow-hidden min-w-32 shadow-lg">
				<button
					type="button"
					class="flex items-center gap-2 w-full px-3 py-2 font-body text-xs text-on-surface hover:bg-surface-high transition-colors cursor-pointer"
					onclick={handleClone}
				>
					<Copy size={14} />
					Clone
				</button>
				<button
					type="button"
					class="flex items-center gap-2 w-full px-3 py-2 font-body text-xs text-error hover:bg-error/10 transition-colors cursor-pointer"
					onclick={handleDelete}
				>
					<Trash2 size={14} />
					Delete
				</button>
			</div>
		{/if}
	</div>
</GlassPanel>
