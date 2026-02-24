<script lang="ts" module>
  export type ToastType = 'success' | 'error' | 'info' | 'warning';

  export interface Toast {
    id: string;
    type: ToastType;
    message: string;
    duration?: number;
  }

  let _toasts = $state<Toast[]>([]);

  export const toastStore = {
    get toasts() { return _toasts; },

    show(message: string, type: ToastType = 'info', duration = 4000) {
      const id = Math.random().toString(36).slice(2);
      const toast: Toast = { id, type, message, duration };
      _toasts = [..._toasts, toast];

      if (duration > 0) {
        setTimeout(() => toastStore.dismiss(id), duration);
      }

      return id;
    },

    success(message: string, duration?: number) {
      return this.show(message, 'success', duration);
    },

    error(message: string, duration?: number) {
      return this.show(message, 'error', duration ?? 6000);
    },

    info(message: string, duration?: number) {
      return this.show(message, 'info', duration);
    },

    dismiss(id: string) {
      _toasts = _toasts.filter((t) => t.id !== id);
    },
  };
</script>

<script lang="ts">
  import { fly } from 'svelte/transition';

  const icons = {
    success: '✓',
    error: '✕',
    info: 'ℹ',
    warning: '⚠',
  };

  const colors = {
    success: 'bg-green-600 border-green-500',
    error: 'bg-red-700 border-red-600',
    info: 'bg-blue-700 border-blue-600',
    warning: 'bg-amber-700 border-amber-600',
  };
</script>

<div
  class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none"
  aria-live="polite"
  aria-atomic="false"
>
  {#each toastStore.toasts as toast (toast.id)}
    <div
      class="pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm text-white shadow-xl max-w-sm {colors[toast.type]}"
      transition:fly={{ y: 20, duration: 200 }}
      role="alert"
    >
      <span class="mt-0.5 font-bold" aria-hidden="true">{icons[toast.type]}</span>
      <span class="flex-1">{toast.message}</span>
      <button
        onclick={() => toastStore.dismiss(toast.id)}
        class="ml-2 opacity-70 hover:opacity-100 transition-opacity"
        aria-label="Dismiss notification"
      >
        ✕
      </button>
    </div>
  {/each}
</div>
