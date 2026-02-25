<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
  }

  let { children }: Props = $props();
</script>

<div class="min-h-screen bg-slate-900 text-white">
  <nav class="border-b border-white/10 px-6 py-3 flex items-center gap-6">
    <a href="/dashboard" class="text-sm text-slate-400 hover:text-white transition-colors">&larr; Dashboard</a>
    <span class="font-bold text-white text-lg">Admin</span>
    <div class="flex gap-4 ml-4">
      <a href="/admin" class="text-sm text-slate-300 hover:text-white transition-colors">Users</a>
      <a href="/admin/storage" class="text-sm text-slate-300 hover:text-white transition-colors">Storage</a>
      <a href="/admin/jobs" class="text-sm text-slate-300 hover:text-white transition-colors">Jobs</a>
      <a href="/admin/audit" class="text-sm text-slate-300 hover:text-white transition-colors">Audit</a>
    </div>
  </nav>

  <main class="max-w-5xl mx-auto px-6 py-10">
    {@render children()}
  </main>
</div>
