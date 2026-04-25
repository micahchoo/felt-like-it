<script lang="ts">
  // Use <svelte:window> for online/offline rather than $effect+addEventListener —
  // the runtime handles cleanup and SSR guards automatically.
  let isOffline = $state(false);

  // navigator is undefined under SSR; sync once on mount.
  $effect(() => {
    isOffline = !navigator.onLine;
  });

  function handleOffline() {
    isOffline = true;
  }

  function handleOnline() {
    isOffline = false;
  }
</script>

<svelte:window onoffline={handleOffline} ononline={handleOnline} />

{#if isOffline}
  <div class="fixed top-0 left-0 right-0 z-[60] glass-panel bg-tertiary/10 text-tertiary text-center py-2 font-body text-sm" role="alert">
    You're offline — some features may be unavailable
  </div>
{/if}
