<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { trpc } from '$lib/utils/trpc.js';
	import { toastStore } from '$lib/components/ui/Toast.svelte';
	import DashboardScreen from '$lib/screens/DashboardScreen.svelte';
	import type { DashboardData, DashboardActions } from '$lib/contracts/dashboard.js';
	import type { MapRecord } from '@felt-like-it/shared-types';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const DEFAULT_VIEWPORT: MapRecord['viewport'] = {
		center: [0, 0],
		zoom: 2,
		bearing: 0,
		pitch: 0,
	};

	function toMapRecord(
		m: { id: string; title: string; description: string | null; basemap: string; createdAt: Date | string; updatedAt: Date | string; layerCount?: number; viewport?: MapRecord['viewport'] }
	): MapRecord {
		return {
			id: m.id,
			userId: '',
			title: m.title,
			description: m.description,
			basemap: m.basemap,
			viewport: m.viewport ?? DEFAULT_VIEWPORT,
			layerCount: m.layerCount ?? 0,
			createdAt: m.createdAt instanceof Date ? m.createdAt : new Date(m.createdAt),
			updatedAt: m.updatedAt instanceof Date ? m.updatedAt : new Date(m.updatedAt),
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
			const map = await trpc.maps.create.mutate({ title, ...(description ? { description } : {}) });
			await goto(`/map/${map.id}`);
		},
		onDelete: async (id: string) => {
			await trpc.maps.delete.mutate({ id });
			toastStore.success('Map deleted.');
			await invalidateAll();
		},
		onClone: async (id: string) => {
			const map = await trpc.maps.clone.mutate({ id });
			toastStore.success('Map duplicated.');
			await goto(`/map/${map.id}`);
		},
		onRetry: async () => {
			await invalidateAll();
		},
	};
</script>

<svelte:head>
	<title>Dashboard — Felt Like It</title>
</svelte:head>

<DashboardScreen data={dashboardData} {actions} status="success" />
