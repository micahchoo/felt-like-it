<script lang="ts">
  import type { Snippet } from 'svelte';

  let { class: className = '', children }: { class?: string; children: Snippet } = $props();
</script>

<header
  class="fixed top-0 left-0 right-0 h-16 z-50 glass-panel tonal-elevation
    flex justify-between items-center px-6 {className}"
>
  {@render children()}
</header>
