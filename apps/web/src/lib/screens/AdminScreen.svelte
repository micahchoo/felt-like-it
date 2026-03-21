<script lang="ts">
	import type { AdminData, AdminActions, AdminStatus } from '$lib/contracts/admin.js';
	import TopBar from '$lib/components/ui/TopBar.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import SkeletonLoader from '$lib/components/ui/SkeletonLoader.svelte';
	import ErrorState from '$lib/components/ui/ErrorState.svelte';
	import UserList from '$lib/components/admin/UserList.svelte';
	import AuditLogViewer from '$lib/components/admin/AuditLogViewer.svelte';
	import StorageStats from '$lib/components/admin/StorageStats.svelte';
	import ImportJobMonitor from '$lib/components/admin/ImportJobMonitor.svelte';
	import Shield from 'lucide-svelte/icons/shield';

	interface Props {
		data: AdminData;
		actions: AdminActions;
		status: AdminStatus;
	}

	let { data, actions, status }: Props = $props();

	type Tab = 'users' | 'audit' | 'storage' | 'jobs';
	let activeTab = $state<Tab>('users');

	const tabs: { key: Tab; label: string }[] = [
		{ key: 'users', label: 'Users' },
		{ key: 'audit', label: 'Audit Log' },
		{ key: 'storage', label: 'Storage' },
		{ key: 'jobs', label: 'Import Jobs' },
	];

	// Adapt AdminData users (PaginatedData<User>) to UserList props.
	// User from shared-types has no isAdmin/disabledAt — synthesise for display.
	const userListRows = $derived(
		data.users.items.map((u) => ({
			id: u.id,
			name: u.name,
			email: u.email,
			isAdmin: false, // shared-types User does not include isAdmin
			disabledAt: null as Date | null,
		}))
	);

	// Adapt AuditLogEntry to AuditLogViewer props.
	// AuditLogEntry has: id, action, userId, entityType, entityId, mapId, metadata, createdAt
	// AuditLogViewer expects: id, action, userId, timestamp, verified
	const auditEntries = $derived(
		data.auditLog.items.map((e) => ({
			id: String(e.id),
			action: e.action,
			userId: e.userId ?? 'system',
			timestamp: e.createdAt,
			verified: true, // hash chain verification not yet wired in mock
		}))
	);

	// Adapt StorageStats contract fields to component props
	const storageProps = $derived({
		uploadVolume: data.storageStats.uploadVolumeBytes,
		maxVolume: data.storageStats.uploadVolumeMax,
		featureCount: data.storageStats.totalFeatures,
		mapCount: data.storageStats.totalMaps,
	});

	// Adapt ImportJob to component props
	const importJobRows = $derived(
		data.importJobs.map((j) => ({
			id: j.id,
			fileName: j.fileName,
			status: j.status,
			progress: j.progress,
			createdAt: j.createdAt,
		}))
	);
</script>

<div class="min-h-screen bg-surface">
	<TopBar>
		<div class="flex items-center gap-3">
			<a href="/" class="text-on-surface-variant hover:text-on-surface transition-colors font-display text-sm">← Home</a>
			<Shield size={18} class="text-primary" />
			<span class="font-display text-lg font-bold text-on-surface">Admin</span>
		</div>
	</TopBar>

	<main class="mt-16 p-6">
		{#if status === 'loading'}
			<SkeletonLoader layout="panel" />
		{:else if status === 'error'}
			<ErrorState message="Failed to load admin data" onretry={actions.onRetry} />
		{:else}
			<div class="max-w-5xl mx-auto flex flex-col gap-6">
				<!-- Tab bar -->
				<div class="flex gap-2 flex-wrap">
					{#each tabs as tab}
						<button
							type="button"
							class="px-4 py-2 rounded-lg font-display text-xs uppercase tracking-wide transition-colors cursor-pointer
								{activeTab === tab.key
									? 'bg-primary text-on-primary'
									: 'bg-surface-high text-on-surface-variant hover:text-on-surface hover:bg-surface-high/80'}"
							onclick={() => (activeTab = tab.key)}
						>
							{tab.label}
						</button>
					{/each}
				</div>

				<!-- Tab content -->
				<div>
					{#if activeTab === 'users'}
						<UserList
							users={userListRows}
							ondisable={(id) => actions.onDisableUser(id)}
							onenable={(id) => actions.onEnableUser(id)}
						/>
					{:else if activeTab === 'audit'}
						<AuditLogViewer entries={auditEntries} />
					{:else if activeTab === 'storage'}
						<StorageStats stats={storageProps} />
					{:else if activeTab === 'jobs'}
						<ImportJobMonitor jobs={importJobRows} />
					{/if}
				</div>
			</div>
		{/if}
	</main>
</div>
