<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    content: string;
    position?: 'top' | 'bottom' | 'left' | 'right';
    children: Snippet;
  }

  let { content, position = 'top', children }: Props = $props();
  let visible = $state(false);

  const posClasses = {
    top: 'bottom-full mb-1.5 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-1.5 left-1/2 -translate-x-1/2',
    left: 'right-full mr-1.5 top-1/2 -translate-y-1/2',
    right: 'left-full ml-1.5 top-1/2 -translate-y-1/2',
  };
</script>

<div
  class="relative inline-flex"
  role="group"
  onmouseenter={() => (visible = true)}
  onmouseleave={() => (visible = false)}
  onfocus={() => (visible = true)}
  onblur={() => (visible = false)}
>
  {@render children()}

  {#if visible && content}
    <div
      class="absolute {posClasses[position]} z-50 pointer-events-none whitespace-nowrap
             rounded bg-surface-lowest px-2 py-1 text-xs text-on-surface-variant shadow-md ring-1 ring-surface-high"
      role="tooltip"
    >
      {content}
    </div>
  {/if}
</div>
