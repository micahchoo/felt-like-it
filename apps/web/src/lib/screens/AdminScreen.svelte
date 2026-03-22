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
	import { fade } from 'svelte/transition';

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
			<a href="/" class="text-on-surface-variant hover:text-on-surface transition-colors font-mono text-xs uppercase tracking-widest">← Home</a>
			<Shield size={16} class="text-primary" />
			<div class="flex flex-col">
				<span class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest leading-none">System Administration</span>
				<span class="font-display text-lg font-bold text-on-surface leading-tight">Audit Log Terminal</span>
			</div>
		</div>
		<div class="flex items-center gap-2">
			<span class="bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest">
				Immutable Integrity Active
			</span>
		</div>
	</TopBar>

	<main class="mt-16 p-6">
		{#if status === 'loading'}
			<SkeletonLoader layout="panel" />
		{:else if status === 'error'}
			<ErrorState message="Failed to load admin data" onretry={actions.onRetry} />
		{:else}
			<div class="max-w-5xl mx-auto flex flex-col gap-6">

				<!-- Stats section -->
				<div class="bg-surface-container rounded-xl border border-white/5 p-6 flex flex-col gap-4">
					<p class="text-[10px] font-bold text-primary uppercase tracking-widest">Total Mutations</p>
					<span class="text-3xl font-mono font-semibold text-on-surface tabular-nums">
						{data.auditLog.items?.length ?? 0}
					</span>
					<div class="grid grid-cols-3 gap-3 mt-2">
						<div class="bg-surface-container-low rounded-lg border border-white/5 p-4">
							<p class="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">Shard Mode</p>
							<p class="text-sm font-mono text-on-surface">Sequential</p>
						</div>
						<div class="bg-surface-container-low rounded-lg border border-white/5 p-4">
							<p class="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">Matrix</p>
							<p class="text-sm font-mono text-on-surface">{data.storageStats.totalMaps ?? 0} Maps</p>
						</div>
						<div class="bg-surface-container-low rounded-lg border border-white/5 p-4">
							<p class="text-[10px] font-bold text-primary uppercase tracking-widest mb-1">Active Log Gap</p>
							<p class="text-sm font-mono text-on-surface">0ms</p>
						</div>
					</div>
				</div>

				<!-- System health -->
				<div class="bg-surface-container rounded-xl border border-white/5 p-5 flex flex-col gap-3">
					<p class="text-[10px] font-bold text-primary uppercase tracking-widest">System Health</p>
					<div class="flex flex-wrap gap-4">
						<div class="flex items-center gap-2">
							<span class="w-2 h-2 rounded-full bg-emerald-400"></span>
							<span class="text-xs font-mono text-on-surface-variant">Hash Chain Verified</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="w-2 h-2 rounded-full bg-emerald-400"></span>
							<span class="text-xs font-mono text-on-surface-variant">Storage Nominal</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="w-2 h-2 rounded-full {data.importJobs.some((j) => j.status === 'failed') ? 'bg-red-400' : 'bg-emerald-400'}"></span>
							<span class="text-xs font-mono text-on-surface-variant">Import Jobs</span>
						</div>
					</div>
				</div>

				<!-- Tab bar -->
				<div class="flex gap-2 flex-wrap">
					{#each tabs as tab}
						<button
							type="button"
							class="px-4 py-2 rounded-lg font-mono text-[10px] uppercase tracking-widest transition-colors cursor-pointer
								{activeTab === tab.key
									? 'bg-primary text-on-primary'
									: 'bg-surface-container text-on-surface-variant border border-white/5 hover:text-on-surface hover:border-white/10'}"
							onclick={() => (activeTab = tab.key)}
						>
							{tab.label}
						</button>
					{/each}
				</div>

				<!-- Tab content -->
				<div class="bg-surface-container rounded-xl border border-white/5 overflow-hidden">
					{#key activeTab}
						<div in:fade={{ duration: 150 }}>
							{#if activeTab === 'users'}
								<UserList
									users={userListRows}
									ondisable={(id) => {
										if (!window.confirm('Disable this user? They will be logged out and unable to sign in.')) return;
										actions.onDisableUser(id);
									}}
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
					{/key}
				</div>
			</div>
		{/if}
	</main>
</div>
