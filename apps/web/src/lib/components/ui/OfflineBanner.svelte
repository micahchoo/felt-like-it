<script lang="ts">
  let isOffline = $state(false);

  $effect(() => {
    const handleOffline = () => { isOffline = true; };
    const handleOnline = () => { isOffline = false; };

    isOffline = !navigator.onLine;
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  });
</script>

{#if isOffline}
  <div class="fixed top-0 left-0 right-0 z-[60] glass-panel bg-tertiary/10 text-tertiary text-center py-2 font-body text-sm" role="alert">
    You're offline — some features may be unavailable
  </div>
{/if}
