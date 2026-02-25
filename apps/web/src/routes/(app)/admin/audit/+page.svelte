<script lang="ts">
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import type { PageData, ActionData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();

  let selectedMapId = $derived(data.selectedMapId ?? '');
  let verifying = $state(false);

  function onMapSelect(e: Event): void {
    const value = (e.target as HTMLSelectElement).value;
    if (value) {
      goto(`/admin/audit?mapId=${value}`, { keepFocus: true });
    } else {
      goto('/admin/audit', { keepFocus: true });
    }
  }

  function formatDate(date: Date | string): string {
    return new Date(date).toLocaleString();
  }

  function truncateId(id: string, len = 8): string {
    return id.length > len ? id.slice(0, len) + '\u2026' : id;
  }

  const actionColors: Record<string, string> = {
    'map.create': 'bg-green-500/20 text-green-300',
    'map.update': 'bg-blue-500/20 text-blue-300',
    'map.delete': 'bg-red-500/20 text-red-300',
    'map.clone': 'bg-purple-500/20 text-purple-300',
    'map.createFromTemplate': 'bg-purple-500/20 text-purple-300',
    'share.create': 'bg-teal-500/20 text-teal-300',
    'share.update': 'bg-teal-500/20 text-teal-300',
    'share.delete': 'bg-orange-500/20 text-orange-300',
    'collaborator.invite': 'bg-cyan-500/20 text-cyan-300',
    'collaborator.remove': 'bg-orange-500/20 text-orange-300',
    'collaborator.updateRole': 'bg-blue-500/20 text-blue-300',
    'apiKey.create': 'bg-amber-500/20 text-amber-300',
    'apiKey.revoke': 'bg-red-500/20 text-red-300',
  };
</script>

<div class="space-y-6">
  <!-- Header -->
  <div class="flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold">Audit Log</h1>
      <p class="text-sm text-slate-400 mt-1">{data.totalEntries} total entries across all maps</p>
    </div>
    <form
      method="POST"
      action="?/verify"
      use:enhance={() => {
        verifying = true;
        return async ({ update }) => {
          verifying = false;
          await update();
        };
      }}
    >
      <button
        type="submit"
        class="inline-flex items-center justify-center font-medium rounded-lg transition-colors h-9 px-3.5 text-sm gap-2 bg-slate-700 text-slate-100 hover:bg-slate-600 disabled:opacity-50 disabled:pointer-events-none"
        disabled={verifying}
      >
        {#if verifying}
          <svg
            class="animate-spin -ml-0.5 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        {/if}
        Verify chain integrity
      </button>
    </form>
  </div>

  <!-- Verification result -->
  {#if form}
    <div class="rounded-lg p-3 {form.valid ? 'bg-green-900/30 ring-1 ring-green-500/30' : 'bg-red-900/30 ring-1 ring-red-500/30'}">
      <p class="text-sm {form.valid ? 'text-green-300' : 'text-red-300'}">
        {#if form.valid}
          Chain intact -- {form.entryCount} entries verified.
        {:else}
          Chain broken at sequence #{form.firstInvalidSeq} ({form.entryCount} total entries).
        {/if}
      </p>
    </div>
  {/if}

  <!-- Map selector -->
  <div class="flex items-end gap-3">
    <div class="flex-1">
      <label for="map-select" class="block text-xs font-medium text-slate-400 mb-1">Select map</label>
      <select
        id="map-select"
        value={selectedMapId}
        onchange={onMapSelect}
        class="w-full rounded-lg bg-slate-700 border border-slate-600 px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <option value="">All maps (choose one to filter)</option>
        {#each data.maps as map (map.id)}
          <option value={map.id}>{map.title}</option>
        {/each}
      </select>
    </div>
  </div>

  <!-- Entries table -->
  {#if data.entries.length > 0}
    <div class="overflow-x-auto">
      <table class="w-full text-sm text-left">
        <thead class="text-xs text-slate-400 uppercase border-b border-white/10">
          <tr>
            <th class="px-4 py-3">Seq</th>
            <th class="px-4 py-3">Action</th>
            <th class="px-4 py-3">Entity</th>
            <th class="px-4 py-3">User</th>
            <th class="px-4 py-3">Time</th>
            <th class="px-4 py-3">Hash</th>
          </tr>
        </thead>
        <tbody>
          {#each data.entries as entry (entry.seq)}
            <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
              <td class="px-4 py-3 text-slate-300 font-mono text-xs">{entry.seq}</td>
              <td class="px-4 py-3">
                <span class="px-2 py-0.5 rounded text-xs font-medium {actionColors[entry.action] ?? 'bg-slate-500/20 text-slate-300'}">
                  {entry.action}
                </span>
              </td>
              <td class="px-4 py-3 text-slate-300">
                <span class="text-xs">{entry.entityType}</span>
                {#if entry.entityId}
                  <span class="text-slate-500 font-mono text-xs block">{truncateId(entry.entityId)}</span>
                {/if}
              </td>
              <td class="px-4 py-3">
                {#if entry.userName}
                  <span class="text-white text-xs">{entry.userName}</span>
                {:else if entry.userId}
                  <span class="text-slate-400 font-mono text-xs">{truncateId(entry.userId)}</span>
                {:else}
                  <span class="text-slate-500 text-xs italic">deleted</span>
                {/if}
              </td>
              <td class="px-4 py-3 text-slate-400 text-xs">{formatDate(entry.createdAt)}</td>
              <td class="px-4 py-3 text-slate-500 font-mono text-xs" title={entry.chainHash}>
                {truncateId(entry.chainHash, 12)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else if data.selectedMapId}
    <p class="text-slate-400 text-center py-10">No audit entries for this map.</p>
  {:else}
    <p class="text-slate-400 text-center py-10">Select a map to view its audit log entries.</p>
  {/if}
</div>
