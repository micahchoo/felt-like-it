<script lang="ts">
  import { page } from '$app/state';
  import { invalidateAll } from '$app/navigation';

  async function retry() {
    await invalidateAll();
  }
</script>

<svelte:head>
  <title>{page.status} — Felt Like It</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-surface-lowest px-4">
  <div class="glass-panel rounded-xl p-8 text-center max-w-md">
    <p class="text-xs font-display uppercase tracking-wider text-on-surface-variant mb-2">
      Error {page.status}
    </p>
    <h1 class="text-xl font-display text-on-surface mb-3">We hit a snag</h1>
    <p class="text-on-surface-variant text-sm mb-6">
      {page.error?.message ?? 'An unexpected error occurred while loading this page.'}
    </p>
    <div class="flex gap-2 justify-center">
      <button
        type="button"
        onclick={retry}
        class="rounded-md bg-surface-high px-4 py-2 text-sm font-display uppercase tracking-wide text-on-surface hover:bg-surface-high/80 transition-colors"
      >
        Retry
      </button>
      <a
        href="/dashboard"
        class="rounded-md bg-primary px-4 py-2 text-sm font-display uppercase tracking-wide text-on-primary hover:bg-primary/90 transition-colors"
      >
        Back to dashboard
      </a>
    </div>
  </div>
</div>
