<script lang="ts">
	import { goto, invalidate } from '$app/navigation';
	import { toastStore } from '$lib/components/ui/Toast.svelte';
	import SettingsScreen from '$lib/screens/SettingsScreen.svelte';
	import type { SettingsData, SettingsActions, SettingsStatus } from '$lib/contracts/settings.js';
	import { INVALIDATE } from '$lib/contracts/invalidate-keys.js';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// One-time new key display — stored locally after creation since it cannot be retrieved again
	let newKey = $state<string | null>(null);
	let newKeyCopied = $state(false);

	const screenData: SettingsData = $derived({
		user: data.user,
		apiKeys: data.apiKeys.map((k) => ({
			...k,
			createdAt: new Date(k.createdAt),
			lastUsedAt: k.lastUsedAt ? new Date(k.lastUsedAt) : null,
		})),
	});

	async function submitAction(action: string, body: FormData): Promise<{ success: boolean; data?: Record<string, unknown>; error?: string }> {
		const res = await fetch(`?/${action}`, {
			method: 'POST',
			body,
		});
		const text = await res.text();
		try {
			// SvelteKit action responses are encoded as __sveltekit_data JSON
			// Parse via deserialize if available, otherwise fall back to plain JSON
			const { deserialize } = await import('$app/forms');
			const result = deserialize(text);
			if (result.type === 'success') {
				return { success: true, data: (result.data ?? {}) as Record<string, unknown> };
			} else if (result.type === 'failure') {
				const d = (result.data ?? {}) as Record<string, unknown>;
				return { success: false, error: (d.message as string) ?? 'An error occurred.' };
			} else if (result.type === 'redirect') {
				// Use SvelteKit goto() to preserve SPA semantics (no full reload).
				// Auth-callback redirects (e.g. /auth/login) don't cross cookie boundaries
				// — the session cookie is already set by the action handler before redirect.
				await goto(result.location);
				return { success: true };
			}
			return { success: false, error: 'Unexpected response.' };
		} catch {
			return { success: false, error: 'Server error.' };
		}
	}

	const actions: SettingsActions = {
		onRetry: async () => {
			await Promise.all([
				invalidate(INVALIDATE.settingsProfile),
				invalidate(INVALIDATE.settingsApiKeys),
			]);
		},

		onUpdateProfile: async (changes) => {
			const body = new FormData();
			if (changes.name !== undefined) body.set('name', changes.name);
			const result = await submitAction('updateProfile', body);
			if (result.success) {
				toastStore.success('Profile updated.');
				await invalidate(INVALIDATE.settingsProfile);
			} else {
				toastStore.error(result.error ?? 'Failed to update profile.');
			}
		},

		onCreateApiKey: async (name, scope) => {
			const body = new FormData();
			body.set('keyName', name);
			body.set('scope', scope);
			const result = await submitAction('createKey', body);
			if (result.success && result.data) {
				const key = result.data.newKey as string | undefined;
				if (key) {
					newKey = key;
					newKeyCopied = false;
					toastStore.success('API key created. Copy it now — it won\'t be shown again.');
				}
				await invalidate(INVALIDATE.settingsApiKeys);
			} else {
				toastStore.error(result.error ?? 'Failed to create API key.');
			}
		},

		onRevokeApiKey: async (id) => {
			const body = new FormData();
			body.set('id', id);
			const result = await submitAction('revokeKey', body);
			if (result.success) {
				toastStore.success('API key revoked.');
				await invalidate(INVALIDATE.settingsApiKeys);
			} else {
				toastStore.error(result.error ?? 'Failed to revoke API key.');
			}
		},
	};

	async function copyNewKey() {
		if (!newKey) return;
		try {
			await navigator.clipboard.writeText(newKey);
			newKeyCopied = true;
			setTimeout(() => { newKeyCopied = false; }, 2000);
		} catch {
			toastStore.error('Failed to copy — try selecting and copying manually.');
		}
	}

	const status: SettingsStatus = 'success';
</script>

<svelte:head><title>Settings — Felt Like It</title></svelte:head>

{#if newKey}
	<div class="fixed top-20 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg px-4">
		<div class="bg-emerald-950/95 border border-emerald-500/40 rounded-xl p-4 shadow-xl flex flex-col gap-2">
			<p class="text-sm font-medium text-emerald-400">
				Key created — copy it now. It won't be shown again.
			</p>
			<div class="flex items-center gap-2">
				<code class="flex-1 block bg-black/40 text-emerald-300 text-xs font-mono px-3 py-2 rounded overflow-x-auto whitespace-nowrap">
					{newKey}
				</code>
				<button
					type="button"
					onclick={copyNewKey}
					class="shrink-0 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs px-3 py-2 transition-colors cursor-pointer"
				>
					{newKeyCopied ? 'Copied!' : 'Copy'}
				</button>
				<button
					type="button"
					onclick={() => { newKey = null; }}
					class="shrink-0 rounded text-emerald-400 hover:text-emerald-300 text-xs px-2 py-2 transition-colors cursor-pointer"
					aria-label="Dismiss"
				>
					✕
				</button>
			</div>
		</div>
	</div>
{/if}

<SettingsScreen data={screenData} {actions} {status} />
