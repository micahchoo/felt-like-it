<script lang="ts">
	import type { SettingsData, SettingsActions, SettingsStatus } from '$lib/contracts/settings.js';
	import TopBar from '$lib/components/ui/TopBar.svelte';
	import GlassPanel from '$lib/components/ui/GlassPanel.svelte';
	import Button from '$lib/components/ui/Button.svelte';
	import Input from '$lib/components/ui/Input.svelte';
	import Badge from '$lib/components/ui/Badge.svelte';
	import SkeletonLoader from '$lib/components/ui/SkeletonLoader.svelte';
	import ErrorState from '$lib/components/ui/ErrorState.svelte';
	import Settings from 'lucide-svelte/icons/settings';
	import Key from 'lucide-svelte/icons/key';
	import Plus from 'lucide-svelte/icons/plus';
	import Trash2 from 'lucide-svelte/icons/trash-2';

	interface Props {
		data: SettingsData;
		actions: SettingsActions;
		status: SettingsStatus;
	}

	let { data, actions, status }: Props = $props();

	let nameValue = $state('');
	let newKeyName = $state('');
	let newKeyScope = $state('read');

	$effect(() => {
		if (status === 'success') {
			nameValue = data.user.name;
		}
	});

	function formatDate(d: Date | null | undefined): string {
		if (!d) return '—';
		return d.toLocaleDateString(undefined, { dateStyle: 'medium' });
	}

	const apiKeyColumns = [
		{ key: 'name', label: 'Name' },
		{ key: 'prefix', label: 'Prefix' },
		{ key: 'createdAt', label: 'Created' },
		{ key: 'lastUsedAt', label: 'Last Used' },
	];
</script>

<div class="min-h-screen bg-surface">
	<TopBar>
		<div class="flex items-center gap-3">
			<a href="/" class="text-on-surface-variant hover:text-on-surface transition-colors font-display text-sm">← Home</a>
			<Settings size={18} class="text-primary" />
			<span class="font-display text-lg font-bold text-on-surface">Settings</span>
		</div>
	</TopBar>

	<main class="mt-16 p-6">
		{#if status === 'loading'}
			<SkeletonLoader layout="panel" />
		{:else if status === 'error'}
			<ErrorState message="Failed to load settings" onretry={actions.onRetry} />
		{:else}
			<div class="max-w-2xl mx-auto flex flex-col gap-6">
				<!-- Account section -->
				<section>
					<h2 class="font-display text-sm uppercase tracking-wide text-on-surface-variant mb-3">
						Account
					</h2>
					<GlassPanel class="p-6 flex flex-col gap-4">
						<div class="flex flex-col gap-1">
							<label for="settings-name" class="font-display text-xs text-on-surface-variant uppercase tracking-wide">
								Name
							</label>
							<Input
								id="settings-name"
								type="text"
								bind:value={nameValue}
								placeholder="Your name"
							/>
						</div>
						<div class="flex flex-col gap-1">
							<label for="settings-email" class="font-display text-xs text-on-surface-variant uppercase tracking-wide">
								Email
							</label>
							<Input
								id="settings-email"
								type="email"
								value={data.user.email}
								disabled
							/>
						</div>
						<div class="flex justify-end">
							<Button
								variant="primary"
								onclick={() => actions.onUpdateProfile({ name: nameValue })}
							>
								Save changes
							</Button>
						</div>
					</GlassPanel>
				</section>

				<!-- API Keys section -->
				<section>
					<div class="flex items-center justify-between mb-3">
						<h2 class="font-display text-sm uppercase tracking-wide text-on-surface-variant flex items-center gap-2">
							<Key size={14} />
							API Keys
						</h2>
					</div>
					<GlassPanel class="p-6 flex flex-col gap-4">
						<!-- Existing keys table -->
						{#if data.apiKeys.length > 0}
							<div class="overflow-x-auto">
								<table class="w-full text-sm">
									<thead>
										<tr>
											{#each apiKeyColumns as col}
												<th class="text-left font-display text-xs uppercase tracking-wide text-on-surface-variant px-3 py-2">
													{col.label}
												</th>
											{/each}
											<th class="px-3 py-2"></th>
										</tr>
									</thead>
									<tbody>
										{#each data.apiKeys as key (key.id)}
											<tr class="hover:bg-surface-high transition-colors">
												<td class="px-3 py-3 font-body text-on-surface">{key.name}</td>
												<td class="px-3 py-3">
													<code class="font-mono text-xs text-primary bg-surface-low px-2 py-0.5 rounded">
														{key.prefix}…
													</code>
												</td>
												<td class="px-3 py-3 font-body text-on-surface-variant text-xs">
													{formatDate(key.createdAt)}
												</td>
												<td class="px-3 py-3 font-body text-on-surface-variant text-xs">
													{formatDate((key as Record<string, unknown>).lastUsedAt as Date | null)}
												</td>
												<td class="px-3 py-3">
													<button
														type="button"
														class="text-error hover:text-error/80 transition-colors cursor-pointer"
														onclick={() => actions.onRevokeApiKey(key.id)}
														aria-label="Revoke {key.name}"
													>
														<Trash2 size={14} />
													</button>
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
							</div>
						{:else}
							<p class="font-body text-sm text-on-surface-variant">No API keys yet.</p>
						{/if}

						<!-- Create new key -->
						<div class="flex flex-col gap-3 pt-2">
							<h3 class="font-display text-xs uppercase tracking-wide text-on-surface-variant">
								Create new key
							</h3>
							<div class="flex gap-3">
								<div class="flex-1">
									<Input
										type="text"
										bind:value={newKeyName}
										placeholder="Key name (e.g. CI Pipeline)"
									/>
								</div>
								<Button
									variant="secondary"
									onclick={() => {
										if (newKeyName.trim()) {
											actions.onCreateApiKey(newKeyName.trim(), newKeyScope);
											newKeyName = '';
										}
									}}
								>
									<Plus size={14} />
									Create
								</Button>
							</div>
						</div>
					</GlassPanel>
				</section>
			</div>
		{/if}
	</main>
</div>
