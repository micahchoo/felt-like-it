<script lang="ts">
  let showUpdate = $state(false);
  let waitingWorker: ServiceWorker | null = $state(null);

  $effect(() => {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.getRegistration().then((registration) => {
      if (!registration) return;

      if (registration.waiting) {
        waitingWorker = registration.waiting;
        showUpdate = true;
        return;
      }

      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;

        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            waitingWorker = newWorker;
            showUpdate = true;
          }
        });
      });
    });
  });

  function handleUpdate() {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: 'SKIP_WAITING' });
      window.location.reload();
    }
  }
</script>

{#if showUpdate}
  <div class="fixed top-0 left-0 right-0 z-[61] glass-panel bg-primary/10 text-on-surface text-center py-2 font-body text-sm flex items-center justify-center gap-3" role="alert">
    <span>New version available</span>
    <button
      onclick={handleUpdate}
      class="bg-primary text-on-primary px-3 py-1 rounded-lg text-xs font-medium hover:bg-primary/90 transition-colors"
    >
      Refresh
    </button>
  </div>
{/if}
