<script lang="ts">
  import { enhance } from '$app/forms';
  import GlassPanel from '$lib/components/ui/GlassPanel.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
  let loading = $state(false);
</script>

<svelte:head><title>Sign In — Felt Like It</title></svelte:head>

<GlassPanel class="p-8 flex flex-col gap-6">
  <h2 class="font-display text-xl font-bold text-on-surface text-center">Sign In</h2>

  <form
    method="POST"
    class="flex flex-col gap-4"
    use:enhance={() => {
      loading = true;
      return ({ update }) => { loading = false; update(); };
    }}
  >
    <div class="flex flex-col gap-1">
      <label for="email" class="font-body text-sm text-on-surface-variant">Email</label>
      <input
        id="email"
        type="email"
        name="email"
        placeholder="you@example.com"
        required
        autocomplete="email"
        class="font-body bg-surface-low text-on-surface rounded-md px-3 py-2 text-sm
          border-b-2 transition-colors placeholder:text-on-surface-variant/50
          focus:border-b-2 focus:border-primary focus:outline-none
          focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface
          {form?.field === 'email' ? 'border-error' : 'border-transparent'}"
        aria-invalid={form?.field === 'email' ? 'true' : undefined}
        aria-describedby={form?.field === 'email' ? 'email-error' : undefined}
      />
      {#if form?.field === 'email'}
        <p id="email-error" class="text-error text-xs font-body" role="alert">{form.message}</p>
      {/if}
    </div>

    <div class="flex flex-col gap-1">
      <label for="password" class="font-body text-sm text-on-surface-variant">Password</label>
      <input
        id="password"
        type="password"
        name="password"
        placeholder="••••••••"
        required
        autocomplete="current-password"
        class="font-body bg-surface-low text-on-surface rounded-md px-3 py-2 text-sm
          border-b-2 transition-colors placeholder:text-on-surface-variant/50
          focus:border-b-2 focus:border-primary focus:outline-none
          focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface
          {form?.field === 'password' ? 'border-error' : 'border-transparent'}"
        aria-invalid={form?.field === 'password' ? 'true' : undefined}
        aria-describedby={form?.field === 'password' ? 'password-error' : undefined}
      />
      {#if form?.field === 'password'}
        <p id="password-error" class="text-error text-xs font-body" role="alert">{form.message}</p>
      {/if}
    </div>

    {#if form?.message && !form.field}
      <p class="text-error text-sm font-body" role="alert">{form.message}</p>
    {/if}

    <Button type="submit" variant="primary" size="lg" {loading}>
      Sign In
    </Button>
  </form>

  <p class="text-center text-sm font-body text-on-surface-variant">
    Don't have an account?
    <a href="/auth/signup" class="text-primary hover:underline">Sign up</a>
  </p>
</GlassPanel>
