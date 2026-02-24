<script lang="ts">
  import '../app.css';
  import Toast from '$lib/components/ui/Toast.svelte';
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();

  function reportError(payload: Record<string, unknown>) {
    void fetch('/api/client-error', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => undefined);
  }

  onMount(() => {
    const onError = (e: ErrorEvent) => {
      const message = e.message ?? 'Unknown error';
      const stack = (e.error instanceof Error ? e.error.stack : null) ?? `${e.filename}:${e.lineno}:${e.colno}`;
      console.error('[UNCAUGHT ERROR]', message, stack);
      reportError({ type: 'uncaught', message, stack, path: window.location.pathname });
    };

    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const message = reason instanceof Error ? reason.message : String(reason ?? 'Unhandled rejection');
      const stack = reason instanceof Error ? (reason.stack ?? message) : message;
      console.error('[UNHANDLED REJECTION]', message, stack);
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

{@render children()}
<Toast />
