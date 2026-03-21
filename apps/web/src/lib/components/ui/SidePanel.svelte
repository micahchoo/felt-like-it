<script lang="ts">
  import type { Snippet } from 'svelte';
  import X from 'lucide-svelte/icons/x';

  let {
    title,
    side = 'left',
    open = true,
    onclose,
    width = 'w-80',
    children,
  }: {
    title: string;
    side?: 'left' | 'right';
    open?: boolean;
    onclose?: (() => void) | undefined;
    width?: string;
    children: Snippet;
  } = $props();

  const positionClass = $derived(side === 'left' ? 'left-0' : 'right-0');
  const translateHidden = $derived(side === 'left' ? '-translate-x-full' : 'translate-x-full');
  const translateVisible = 'translate-x-0';
  const transform = $derived(open ? translateVisible : translateHidden);
</script>

<aside
  class="fixed top-16 bottom-0 {positionClass} {width} z-40 glass-panel tonal-elevation
    flex flex-col transition-transform duration-300 ease-in-out {transform}"
>
  <header class="flex items-center justify-between px-4 py-3 border-b border-white/10">
    <h2 class="font-display text-lg font-semibold text-on-surface">{title}</h2>
    {#if onclose}
      <button
        onclick={onclose}
        class="p-1 rounded hover:bg-white/10 text-on-surface-variant transition-colors"
        aria-label="Close panel"
      >
        <X size={18} />
      </button>
    {/if}
  </header>

  <div class="flex-1 overflow-y-auto scrollbar-thin px-4 py-3">
    {@render children()}
  </div>
</aside>
