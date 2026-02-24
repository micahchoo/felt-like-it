<script lang="ts">
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
</script>

<h1 class="text-2xl font-bold mb-6">Users</h1>

<div class="overflow-x-auto">
  <table class="w-full text-sm text-left">
    <thead class="text-xs text-slate-400 uppercase border-b border-white/10">
      <tr>
        <th class="px-4 py-3">Name</th>
        <th class="px-4 py-3">Email</th>
        <th class="px-4 py-3">Role</th>
        <th class="px-4 py-3">Created</th>
      </tr>
    </thead>
    <tbody>
      {#each data.users as user (user.id)}
        <tr class="border-b border-white/5 hover:bg-white/5 transition-colors">
          <td class="px-4 py-3 font-medium text-white">{user.name}</td>
          <td class="px-4 py-3 text-slate-300">{user.email}</td>
          <td class="px-4 py-3">
            {#if user.isAdmin}
              <span class="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30">Admin</span>
            {:else}
              <span class="text-slate-500">User</span>
            {/if}
          </td>
          <td class="px-4 py-3 text-slate-400">{new Date(user.createdAt).toLocaleDateString()}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</div>

{#if data.users.length === 0}
  <p class="text-slate-400 text-center py-10">No users found.</p>
{/if}
