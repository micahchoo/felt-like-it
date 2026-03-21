<script lang="ts">
  import type { Snippet } from 'svelte';
  let { children }: { children: Snippet } = $props();
</script>

<div class="bg-surface min-h-screen flex items-center justify-center p-4">
  <div class="w-full max-w-sm flex flex-col gap-6">
    <div class="text-center">
      <span class="font-display text-4xl font-bold text-primary">FLIT</span>
    </div>
    {@render children()}
  </div>
</div>
