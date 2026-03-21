<script lang="ts">
	import AdminScreen from '$lib/screens/AdminScreen.svelte';
	import { trpc } from '$lib/utils/trpc.js';
	import { toastStore } from '$lib/components/ui/Toast.svelte';
	import { invalidateAll } from '$app/navigation';
	import type { PageData } from './$types';
	import type { AdminData, AdminActions } from '$lib/contracts/admin.js';

	let { data }: { data: PageData } = $props();

	const adminData = $derived<AdminData>({
		users: {
			items: data.users.map((u) => ({
				id: u.id,
				name: u.name,
				email: u.email,
				createdAt: u.createdAt,
				updatedAt: u.createdAt,
				isAdmin: u.isAdmin,
				disabledAt: u.disabledAt,
			})),
			totalCount: data.users.length,
			nextCursor: null,
		},
		auditLog: {
			items: data.auditLog.map((e) => ({
				id: String(e.id),
				action: e.action,
				userId: e.userId,
				entityType: e.entityType,
				entityId: e.entityId ?? null,
				mapId: e.mapId,
				metadata: e.metadata ?? {},
				createdAt: e.createdAt,
			})),
			totalCount: data.auditLog.length,
			nextCursor: null,
		},
		storageStats: data.storageStats,
		importJobs: data.importJobs as AdminData['importJobs'],
	});

	const actions: AdminActions = {
		onRetry: async () => {
			await invalidateAll();
		},
		onDisableUser: async (id: string) => {
			try {
				await trpc.admin.toggleDisabled.mutate({ userId: id });
				toastStore.success('User disabled.');
				await invalidateAll();
			} catch (e: unknown) {
				toastStore.error(e instanceof Error ? e.message : 'Failed to disable user.');
			}
		},
		onEnableUser: async (id: string) => {
			try {
				await trpc.admin.toggleDisabled.mutate({ userId: id });
				toastStore.success('User enabled.');
				await invalidateAll();
			} catch (e: unknown) {
				toastStore.error(e instanceof Error ? e.message : 'Failed to enable user.');
			}
		},
		onCreateUser: async (userData: { email: string; name: string; password: string }) => {
			try {
				await trpc.admin.createUser.mutate({
					email: userData.email,
					name: userData.name,
					password: userData.password,
				});
				toastStore.success('User created.');
				await invalidateAll();
			} catch (e: unknown) {
				toastStore.error(e instanceof Error ? e.message : 'Failed to create user.');
				throw e;
			}
		},
		onVerifyAuditLog: async () => {
			// Audit chain verification not yet implemented in this route
			return true;
		},
	};
</script>

<AdminScreen data={adminData} {actions} status="success" />
