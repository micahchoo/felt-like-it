<script lang="ts">
  import { enhance } from '$app/forms';
  import Input from '$lib/components/ui/Input.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let updatingProfile = $state(false);
  let changingPassword = $state(false);
  let resettingDemo = $state(false);
  let creatingKey = $state(false);
  let revokingKeyId = $state<string | null>(null);
  let newKeyCopied = $state(false);

  $effect(() => {
    if (form?.success && !('newKey' in (form ?? {}))) toastStore.success(form?.message ?? 'Saved.');
  });

  function copyNewKey() {
    const key = (form as { newKey?: string } | null)?.newKey;
    if (!key) return;
    navigator.clipboard.writeText(key).then(() => {
      newKeyCopied = true;
      setTimeout(() => { newKeyCopied = false; }, 2000);
    }).catch(() => undefined);
  }

  function formatDate(d: Date | null | undefined): string {
    if (!d) return 'Never';
    return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
</script>

<svelte:head><title>Settings — Felt Like It</title></svelte:head>

<div class="min-h-screen bg-slate-900 text-white">
  <nav class="border-b border-white/10 px-6 py-3 flex items-center gap-4">
    <a href="/dashboard" class="font-bold text-white text-lg">🗺 Felt Like It</a>
    <span class="flex-1"></span>
    <form method="POST" action="/auth/logout" use:enhance>
      <button type="submit" class="text-sm text-slate-400 hover:text-white transition-colors">
        Sign out
      </button>
    </form>
  </nav>

  <main class="max-w-lg mx-auto px-6 py-10 space-y-8">
    <h1 class="text-2xl font-bold text-white">Settings</h1>

    <!-- Profile -->
    <section class="bg-slate-800 rounded-xl p-6 ring-1 ring-white/10 space-y-4">
      <h2 class="text-base font-semibold text-white">Profile</h2>
      <form
        method="POST"
        action="?/updateProfile"
        class="space-y-4"
        use:enhance={() => {
          updatingProfile = true;
          return ({ update }) => { updatingProfile = false; update(); };
        }}
      >
        <Input
          label="Name"
          name="name"
          type="text"
          value={data.user.name}
          required
          error={form?.field === 'name' ? form.message : undefined}
        />
        <Input
          label="Email"
          type="email"
          value={data.user.email}
          disabled
          hint="Email cannot be changed."
        />
        <Button type="submit" variant="primary" size="sm" loading={updatingProfile}>
          Save profile
        </Button>
      </form>
    </section>

    <!-- Password -->
    <section class="bg-slate-800 rounded-xl p-6 ring-1 ring-white/10 space-y-4">
      <h2 class="text-base font-semibold text-white">Change Password</h2>
      <form
        method="POST"
        action="?/changePassword"
        class="space-y-4"
        use:enhance={() => {
          changingPassword = true;
          return ({ update }) => { changingPassword = false; update(); };
        }}
      >
        <Input
          label="Current password"
          name="currentPassword"
          type="password"
          required
          autocomplete="current-password"
          error={form?.field === 'currentPassword' ? form.message : undefined}
        />
        <Input
          label="New password"
          name="newPassword"
          type="password"
          required
          autocomplete="new-password"
          hint="Minimum 8 characters"
          error={form?.field === 'newPassword' ? form.message : undefined}
        />
        <Button type="submit" variant="primary" size="sm" loading={changingPassword}>
          Update password
        </Button>
      </form>
    </section>

    <!-- API Keys -->
    <section class="bg-slate-800 rounded-xl p-6 ring-1 ring-white/10 space-y-4">
      <div>
        <h2 class="text-base font-semibold text-white">API Keys</h2>
        <p class="text-sm text-slate-400 mt-1">
          Use Bearer tokens for programmatic access:
          <code class="text-slate-300 bg-slate-700 px-1 rounded text-xs">Authorization: Bearer flk_…</code>
        </p>
        <a
          href="/api/v1/docs"
          target="_blank"
          class="inline-flex items-center gap-1.5 text-sm text-blue-400 hover:text-blue-300 transition-colors mt-1"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          API Documentation
        </a>
      </div>

      <!-- One-time key display banner -->
      {#if (form as { newKey?: string } | null)?.newKey}
        {@const newKey = (form as { newKey: string }).newKey}
        <div class="bg-emerald-950/60 border border-emerald-500/30 rounded-lg p-4 space-y-2">
          <p class="text-sm font-medium text-emerald-400">
            Key created — copy it now. It won't be shown again.
          </p>
          <div class="flex items-center gap-2">
            <code class="flex-1 block bg-slate-900 text-emerald-300 text-xs font-mono px-3 py-2 rounded overflow-x-auto whitespace-nowrap">
              {newKey}
            </code>
            <button
              type="button"
              onclick={copyNewKey}
              class="shrink-0 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs px-3 py-2 transition-colors"
            >
              {newKeyCopied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      {/if}

      <!-- Error from createKey / revokeKey -->
      {#if form?.field === 'apiKey'}
        <p class="text-sm text-red-400">{form.message}</p>
      {/if}

      <!-- Existing keys list -->
      {#if data.apiKeys.length > 0}
        <ul class="space-y-2">
          {#each data.apiKeys as key (key.id)}
            <li class="flex items-center gap-3 bg-slate-700/50 rounded-lg px-3 py-2">
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-white truncate">{key.name}</p>
                <p class="text-xs text-slate-400">
                  <span class="font-mono">{key.prefix}…</span>
                  · Created {formatDate(key.createdAt)}
                  · Last used {formatDate(key.lastUsedAt)}
                </p>
              </div>
              <form
                method="POST"
                action="?/revokeKey"
                use:enhance={() => {
                  revokingKeyId = key.id;
                  return ({ update }) => { revokingKeyId = null; update(); };
                }}
              >
                <input type="hidden" name="id" value={key.id} />
                <button
                  type="submit"
                  class="text-xs text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                  disabled={revokingKeyId === key.id}
                >
                  {revokingKeyId === key.id ? 'Revoking…' : 'Revoke'}
                </button>
              </form>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-sm text-slate-500">No API keys yet.</p>
      {/if}

      <!-- Create new key -->
      <form
        method="POST"
        action="?/createKey"
        class="flex items-end gap-3"
        use:enhance={() => {
          creatingKey = true;
          return ({ update }) => { creatingKey = false; update(); };
        }}
      >
        <div class="flex-1">
          <Input
            label="Key name"
            name="keyName"
            type="text"
            placeholder="e.g. CI pipeline"
            required
          />
        </div>
        <Button type="submit" variant="primary" size="sm" loading={creatingKey}>
          Create key
        </Button>
      </form>
    </section>

    {#if data.user.email === 'demo@felt-like-it.local'}
      <!-- Danger Zone — only visible on demo account -->
      <section class="bg-red-950/40 rounded-xl p-6 ring-1 ring-red-500/30 space-y-4">
        <div>
          <h2 class="text-base font-semibold text-red-400">Danger Zone</h2>
          <p class="text-sm text-slate-400 mt-1">
            Reset this demo account to its original state. All maps, layers, and features you've
            added will be deleted and replaced with the original San Francisco Parks demo data.
          </p>
        </div>
        <form
          method="POST"
          action="?/resetDemo"
          use:enhance={() => {
            resettingDemo = true;
            return ({ update }) => { resettingDemo = false; update(); };
          }}
        >
          {#if form?.field === 'demoReset'}
            <p class="text-sm text-red-400 mb-3">{form.message}</p>
          {/if}
          <Button type="submit" variant="danger" size="sm" loading={resettingDemo}>
            Reset demo data
          </Button>
        </form>
      </section>
    {/if}
  </main>
</div>
