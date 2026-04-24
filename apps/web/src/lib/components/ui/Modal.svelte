<script lang="ts">
  import type { Snippet } from 'svelte';
  import { tick } from 'svelte';
  import { fade } from 'svelte/transition';

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

  let dialogEl = $state<HTMLDivElement | undefined>(undefined);
  let previousFocus: HTMLElement | null = null;

  // Capture focus before opening, restore on close
  $effect(() => {
    if (open && dialogEl) {
      previousFocus = document.activeElement as HTMLElement | null;
      tick().then(() => {
        const focusable = dialogEl?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        focusable?.[0]?.focus();
      });
    }
    return () => {
      previousFocus?.focus();
      previousFocus = null;
    };
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && dismissible) {
      close();
      return;
    }
    // Trap Tab within modal
    if (e.key === 'Tab' && dialogEl) {
      const focusable = dialogEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
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
    transition:fade={{ duration: 150 }}
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
      bind:this={dialogEl}
      class="relative z-10 w-full max-w-lg rounded-xl bg-surface-container shadow-2xl ring-1 ring-white/10"
    >
      {#if title}
        <div class="flex items-center justify-between px-5 py-4 border-b border-white/5">
          <h2 id="modal-title" class="text-base font-semibold text-white">{title}</h2>
          {#if dismissible}
            <button
              onclick={close}
              class="text-on-surface-variant hover:text-white transition-colors"
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
        <div class="px-5 py-4 border-t border-white/5 flex justify-end gap-2">
          {@render footer()}
        </div>
      {/if}
    </div>
  </div>
{/if}
