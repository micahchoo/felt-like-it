<script lang="ts">
  import '../app.css';
  import Toast, { toastStore } from '$lib/components/ui/Toast.svelte';
  import OfflineBanner from '$lib/components/ui/OfflineBanner.svelte';
  import InstallPrompt from '$lib/components/ui/InstallPrompt.svelte';
  import UpdateBanner from '$lib/components/ui/UpdateBanner.svelte';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  function reportError(payload: Record<string, unknown>) {
    // Deliberately swallow — surfacing a failure of the error reporter would
    // create an infinite loop (the toast on uncaught error would itself report,
    // which would itself fail, etc.). Server-side observability picks up the
    // gap via missing-heartbeat alerting, not via this channel.
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => undefined);
  }

  const USER_FACING_ERROR_TOAST = 'Something went wrong. Please refresh the page if it persists.';

  onMount(() => {
    const onError = (e: ErrorEvent) => {
      const message = e.message ?? 'Unknown error';
      const stack = (e.error instanceof Error ? e.error.stack : null) ?? `${e.filename}:${e.lineno}:${e.colno}`;
      console.error('[UNCAUGHT ERROR]', message, stack);
      toastStore.error(USER_FACING_ERROR_TOAST);
      reportError({ type: 'uncaught', message, stack, path: window.location.pathname });
    };

    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const message = reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection');
      const stack = reason instanceof Error ? (reason.stack ?? message) : message;
      console.error('[UNHANDLED REJECTION]', message, stack);
      toastStore.error(USER_FACING_ERROR_TOAST);
      reportError({ type: 'rejection', message, stack, path: window.location.pathname });
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);

    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  });
</script>

<OfflineBanner />
<UpdateBanner />
<InstallPrompt />
{@render children()}
<Toast />
