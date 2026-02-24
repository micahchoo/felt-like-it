<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<div class="min-h-screen bg-slate-900 flex items-center justify-center p-4">
  <div class="w-full max-w-sm">
    <div class="text-center mb-8">
      <span class="text-3xl">🗺</span>
      <h1 class="text-2xl font-bold text-white mt-2">Felt Like It</h1>
      <p class="text-slate-400 text-sm mt-1">Self-hosted collaborative GIS</p>
    </div>
    <div class="bg-slate-800 rounded-2xl p-6 shadow-2xl ring-1 ring-white/10">
      {@render children()}
    </div>
  </div>
</div>
