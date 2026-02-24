<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const statusColors: Record<string, string> = {
    pending: 'bg-slate-500/20 text-slate-300',
    processing: 'bg-blue-500/20 text-blue-300',
    done: 'bg-green-500/20 text-green-300',
    failed: 'bg-red-500/20 text-red-300',
  };
</script>

<h1 class="text-2xl font-bold mb-6">Import Jobs</h1>

<!-- Status summary -->
<div class="flex gap-4 mb-6">
  {#each Object.entries(data.counts) as [status, count] (status)}
    <div class="bg-slate-800 rounded-lg px-4 py-2 ring-1 ring-white/10">
      <span class="text-xs text-slate-400 capitalize">{status}</span>
      <span class="ml-2 text-white font-bold">{count}</span>
    </div>
  {/each}
</div>

<div class="overflow-x-auto">
  <table class="w-full text-sm text-left">
    <thead class="text-xs text-slate-400 uppercase border-b border-white/10">
      <tr>
        <th class="px-4 py-3">File</th>
        <th class="px-4 py-3">Status</th>
        <th class="px-4 py-3">Progress</th>
        <th class="px-4 py-3">Error</th>
        <th class="px-4 py-3">Created</th>
      </tr>
    </thead>
    <tbody>
      {#each data.jobs as job (job.id)}
        <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
          <td class="px-4 py-3 font-medium text-white">{job.fileName}</td>
          <td class="px-4 py-3">
            <span class="px-2 py-0.5 rounded text-xs font-medium capitalize {statusColors[job.status] ?? 'text-slate-400'}">
              {job.status}
            </span>
          </td>
          <td class="px-4 py-3 text-slate-300">{job.progress}%</td>
          <td class="px-4 py-3 text-red-400 max-w-xs truncate">{job.errorMessage ?? ''}</td>
          <td class="px-4 py-3 text-slate-400">{new Date(job.createdAt).toLocaleString()}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if data.jobs.length === 0}
  <p class="text-slate-400 text-center py-10">No import jobs found.</p>
{/if}
