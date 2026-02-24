<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<h1 class="text-2xl font-bold mb-6">Storage</h1>

<div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
  <div class="bg-slate-800 rounded-xl p-6 ring-1 ring-white/10">
    <div class="text-sm text-slate-400 mb-1">Upload directory</div>
    <div class="text-white font-mono text-sm">{data.uploadDir}</div>
  </div>

  <div class="bg-slate-800 rounded-xl p-6 ring-1 ring-white/10">
    <div class="text-sm text-slate-400 mb-1">Total size</div>
    <div class="text-2xl font-bold text-white">{data.totalFormatted}</div>
  </div>

  <div class="bg-slate-800 rounded-xl p-6 ring-1 ring-white/10">
    <div class="text-sm text-slate-400 mb-1">File count</div>
    <div class="text-2xl font-bold text-white">{data.fileCount}</div>
  </div>
</div>
