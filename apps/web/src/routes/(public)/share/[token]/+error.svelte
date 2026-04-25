<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>Link not available — Felt Like It</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-surface-lowest px-4">
  <div class="glass-panel rounded-xl p-8 text-center max-w-md">
    <h1 class="text-xl font-display text-on-surface mb-2">Link not available</h1>
    <p class="text-on-surface-variant text-sm">
      {page.error?.message ?? 'This share link is invalid or has expired. Please ask the map owner for a new link.'}
    </p>
  </div>
</div>
