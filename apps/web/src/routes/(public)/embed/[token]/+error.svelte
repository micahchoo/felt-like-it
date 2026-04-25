<script lang="ts">
  import { page } from '$app/state';
</script>

<svelte:head>
  <title>Embed unavailable</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<div class="flex min-h-screen items-center justify-center bg-surface-lowest px-4">
  <div class="glass-panel rounded-xl p-6 text-center max-w-sm">
    <h1 class="text-base font-display text-on-surface mb-1">Embed unavailable</h1>
    <p class="text-on-surface-variant text-xs">
      {page.error?.message ?? 'This embed link is invalid or has expired.'}
    </p>
  </div>
</div>
