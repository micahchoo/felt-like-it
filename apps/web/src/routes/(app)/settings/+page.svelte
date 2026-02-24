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

  $effect(() => {
    if (form?.success) toastStore.success(form.message ?? 'Saved.');
  });
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
