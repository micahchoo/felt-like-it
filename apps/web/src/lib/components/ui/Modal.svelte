<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title?: string;
    /** When false, Escape, backdrop-click, and the X button are disabled. Default: true. */
    dismissible?: boolean;
    onclose?: () => void;
    children: Snippet;
    footer?: Snippet;
  }

  let { open = $bindable(), title, dismissible = true, onclose, children, footer }: Props = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && dismissible) close();
  }

  function close() {
    if (!dismissible) return;
    open = false;
    onclose?.();
  }
</script>

<svelte:window onkeydown={open ? handleKeydown : undefined} />

{#if open}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
    role="dialog"
    aria-modal="true"
    aria-labelledby={title ? 'modal-title' : undefined}
  >
    <!-- Click outside to close -->
    <button
      class="absolute inset-0 cursor-default"
      tabindex="-1"
      onclick={close}
      aria-hidden="true"
    ></button>

    <!-- Modal content -->
    <div
      class="relative z-10 w-full max-w-lg rounded-xl bg-slate-800 shadow-2xl ring-1 ring-white/10"
    >
      {#if title}
        <div class="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h2 id="modal-title" class="text-base font-semibold text-white">{title}</h2>
          {#if dismissible}
            <button
              onclick={close}
              class="text-slate-400 hover:text-white transition-colors"
              aria-label="Close dialog"
            >
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          {/if}
        </div>
      {/if}

      <div class="px-5 py-4">
        {@render children()}
      </div>

      {#if footer}
        <div class="px-5 py-4 border-t border-white/10 flex justify-end gap-2">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}
