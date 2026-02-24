<script lang="ts">
  import { enhance } from '$app/forms';
  import Input from '$lib/components/ui/Input.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import type { ActionData } from './$types';

  let { form }: { form: ActionData } = $props();
  let loading = $state(false);
</script>

<svelte:head><title>Create Account — Felt Like It</title></svelte:head>

<h2 class="text-lg font-semibold text-white mb-5">Create account</h2>

<form
  method="POST"
  class="space-y-4"
  use:enhance={() => {
    loading = true;
    return ({ update }) => { loading = false; update(); };
  }}
>
  <Input
    label="Name"
    type="text"
    name="name"
    placeholder="Your name"
    required
    autocomplete="name"
    error={form?.field === 'name' ? form.message : undefined}
  />

  <Input
    label="Email"
    type="email"
    name="email"
    placeholder="you@example.com"
    required
    autocomplete="email"
    error={form?.field === 'email' ? form.message : undefined}
  />

  <Input
    label="Password"
    type="password"
    name="password"
    placeholder="At least 8 characters"
    required
    autocomplete="new-password"
    hint="Minimum 8 characters"
    error={form?.field === 'password' ? form.message : undefined}
  />

  {#if form?.message && !form.field}
    <p class="text-sm text-red-400" role="alert">{form.message}</p>
  {/if}

  <Button type="submit" variant="primary" {loading} class="w-full">
    Create account
  </Button>
</form>

<p class="text-sm text-slate-400 text-center mt-4">
  Already have an account?
  <a href="/auth/login" class="text-blue-400 hover:text-blue-300 transition-colors">Sign in</a>
</p>
