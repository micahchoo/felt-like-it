<script lang="ts">
  let deferredPrompt: Event | null = $state(null);
  let dismissed = $state(false);
  let isInstalled = $state(false);

  $effect(() => {
    dismissed = localStorage.getItem('flit-install-dismissed') === 'true';
    isInstalled = window.matchMedia('(display-mode: standalone)').matches;

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt = e;
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  });

  function handleInstall() {
    if (deferredPrompt && 'prompt' in deferredPrompt) {
      (deferredPrompt as { prompt: () => void }).prompt();
      deferredPrompt = null;
    }
  }

  function handleDismiss() {
    dismissed = true;
    localStorage.setItem('flit-install-dismissed', 'true');
  }
</script>

{#if deferredPrompt && !dismissed && !isInstalled}
  <div class="fixed bottom-4 left-4 right-4 z-50 glass-panel p-4 flex items-center justify-between gap-4 max-w-md mx-auto">
    <span class="font-body text-sm text-on-surface">Install FLIT for a better experience</span>
    <div class="flex items-center gap-2">
      <button
        onclick={handleDismiss}
        class="text-tertiary text-sm font-body hover:underline"
      >
        Not now
      </button>
      <button
        onclick={handleInstall}
        class="bg-amber-500 text-white px-4 py-1.5 rounded-lg text-sm font-body font-medium hover:bg-amber-600 transition-colors"
      >
        Install FLIT
      </button>
    </div>
  </div>
{/if}
