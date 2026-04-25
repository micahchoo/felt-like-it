<script lang="ts">
  // Use <svelte:window> for beforeinstallprompt / appinstalled — Svelte handles
  // cleanup automatically. Initial localStorage / matchMedia probes still need
  // $effect (mount-only, browser-guarded).
  let deferredPrompt: Event | null = $state(null);
  let dismissed = $state(false);
  let isInstalled = $state(false);

  $effect(() => {
    try {
      dismissed = localStorage.getItem('flit-install-dismissed') === 'true';
    } catch {
      // Private browsing or quota exceeded; treat as not dismissed
      dismissed = false;
    }
    isInstalled = window.matchMedia('(display-mode: standalone)').matches;

    // `appinstalled` isn't in Svelte's SvelteWindowAttributes typing, so we
    // can't bind it via <svelte:window>; fall back to addEventListener with
    // explicit cleanup. `beforeinstallprompt` IS supported and bound below.
    const handleAppInstalled = () => {
      isInstalled = true;
      deferredPrompt = null;
    };
    window.addEventListener('appinstalled', handleAppInstalled);
    return () => window.removeEventListener('appinstalled', handleAppInstalled);
  });

  function handleBeforeInstall(e: Event) {
    e.preventDefault();
    deferredPrompt = e;
  }

  function handleInstall() {
    if (deferredPrompt && 'prompt' in deferredPrompt) {
      (deferredPrompt as { prompt: () => void }).prompt();
      deferredPrompt = null;
    }
  }

  function handleDismiss() {
    dismissed = true;
    try {
      localStorage.setItem('flit-install-dismissed', 'true');
    } catch {
      // Private browsing or quota exceeded; silently ignore
    }
  }
</script>

<svelte:window onbeforeinstallprompt={handleBeforeInstall} />

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
