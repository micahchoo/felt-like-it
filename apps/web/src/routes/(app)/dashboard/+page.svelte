<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { trpc } from '$lib/utils/trpc.js';
	import { toastStore } from '$lib/components/ui/Toast.svelte';
	import DashboardScreen from '$lib/screens/DashboardScreen.svelte';
	import type { DashboardData, DashboardActions } from '$lib/contracts/dashboard.js';
	import type { MapRecord } from '@felt-like-it/shared-types';
	import { INVALIDATE } from '$lib/contracts/invalidate-keys.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const DEFAULT_VIEWPORT: MapRecord['viewport'] = {
		center: [0, 0],
		zoom: 2,
		bearing: 0,
		pitch: 0,
	};

	function toMapRecord(
		m: { id: string; title: string; description: string | null; basemap: string; createdAt: string; updatedAt: string; layerCount?: number; viewport?: MapRecord['viewport'] }
	): MapRecord {
		return {
			id: m.id,
			userId: '',
			title: m.title,
			description: m.description,
			basemap: m.basemap,
			viewport: m.viewport ?? DEFAULT_VIEWPORT,
			layerCount: m.layerCount ?? 0,
			createdAt: new Date(m.createdAt),
			updatedAt: new Date(m.updatedAt),
		};
	}

	const dashboardData = $derived<DashboardData>({
		maps: data.maps.map(toMapRecord),
		collaboratingMaps: data.sharedMaps.map(toMapRecord),
		templates: data.templates.map((t) => ({
			id: t.id,
			userId: '',
			title: t.title,
			description: t.description ?? null,
			basemap: t.basemap,
			viewport: t.viewport ?? DEFAULT_VIEWPORT,
			layerCount: 0,
			createdAt: new Date(0),
			updatedAt: new Date(0),
		})),
	});

	const actions: DashboardActions = {
		onCreate: async (title: string, description?: string) => {
			try {
				const map = await trpc.maps.create.mutate({ title, ...(description ? { description } : {}) });
				await goto(`/map/${map.id}`);
			} catch (err) {
				toastStore.error('Failed to create map.');
				console.error('[dashboard] create failed:', err);
			}
		},
		onDelete: async (id: string) => {
			try {
				await trpc.maps.delete.mutate({ id });
				toastStore.success('Map deleted.');
				await invalidate(INVALIDATE.dashboardMaps);
			} catch (err) {
				toastStore.error('Failed to delete map.');
				console.error('[dashboard] delete failed:', err);
			}
		},
		onClone: async (id: string) => {
			try {
				const map = await trpc.maps.clone.mutate({ id });
				toastStore.success('Map duplicated.');
				await goto(`/map/${map.id}`);
			} catch (err) {
				toastStore.error('Failed to duplicate map.');
				console.error('[dashboard] clone failed:', err);
			}
		},
		onRetry: async () => {
			await invalidate(INVALIDATE.dashboardMaps);
		},
	};
</script>

<svelte:head>
	<title>Dashboard — Felt Like It</title>
</svelte:head>

<DashboardScreen data={dashboardData} {actions} status="success" />
