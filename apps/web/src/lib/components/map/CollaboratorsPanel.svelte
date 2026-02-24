<script lang="ts">
  import { trpc } from '$lib/utils/trpc.js';
  import Button from '$lib/components/ui/Button.svelte';

  interface Props {
    mapId: string;
  }

  /**
   * Collaborator shape from tRPC collaborators.list.
   * createdAt is an ISO-8601 string (tRPC JSON wire type).
   */
  interface CollaboratorEntry {
    id: string;
    mapId: string;
    userId: string;
    role: string;
    invitedBy: string | null;
    createdAt: string;
    email: string;
    name: string;
  }

  let { mapId }: Props = $props();

  let collaborators = $state<CollaboratorEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let inviteEmail = $state('');
  let inviteRole = $state<'viewer' | 'commenter' | 'editor'>('viewer');
  let inviting = $state(false);

  const ROLES = ['viewer', 'commenter', 'editor'] as const;

  async function loadCollaborators() {
    loading = true;
    error = null;
    try {
      const rows = await trpc.collaborators.list.query({ mapId });
      collaborators = rows as CollaboratorEntry[];
    } catch {
      error = 'Could not load collaborators.';
    } finally {
      loading = false;
    }
  }

  $effect(() => { loadCollaborators(); });

  async function handleInvite(e: Event) {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    inviting = true;
    error = null;
    try {
      await trpc.collaborators.invite.mutate({ mapId, email, role: inviteRole });
      inviteEmail = '';
      await loadCollaborators();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message;
      error = msg ?? 'Failed to invite collaborator.';
    } finally {
      inviting = false;
    }
  }

  async function handleRemove(userId: string) {
    error = null;
    try {
      await trpc.collaborators.remove.mutate({ mapId, userId });
      collaborators = collaborators.filter((c) => c.userId !== userId);
    } catch {
      error = 'Failed to remove collaborator.';
    }
  }

  async function handleRoleChange(userId: string, role: string) {
    error = null;
    try {
      await trpc.collaborators.updateRole.mutate({
        mapId,
        userId,
        role: role as 'viewer' | 'commenter' | 'editor',
      });
      collaborators = collaborators.map((c) => (c.userId === userId ? { ...c, role } : c));
    } catch {
      error = 'Failed to update role.';
    }
  }

  function roleColor(role: string): string {
    if (role === 'editor') return 'text-blue-400';
    if (role === 'commenter') return 'text-yellow-400';
    return 'text-slate-400';
  }
</script>

<div class="flex flex-col h-full bg-slate-800 border-l border-white/10">
  <!-- Header -->
  <div class="px-3 py-2 border-b border-white/10 shrink-0 flex items-center gap-2">
    <span class="text-xs font-semibold text-slate-400 uppercase tracking-wide flex-1">Collaborators</span>
    {#if collaborators.length > 0}
      <span class="text-xs text-slate-500">{collaborators.length}</span>
    {/if}
  </div>

  <!-- List -->
  <div class="flex-1 overflow-y-auto min-h-0">
    {#if loading}
      <div class="flex items-center justify-center h-16 text-slate-500 text-xs">Loading…</div>
    {:else if error}
      <div class="px-3 py-2 text-red-400 text-xs">{error}</div>
    {:else if collaborators.length === 0}
      <div class="flex items-center justify-center h-16 text-slate-500 text-xs">No collaborators yet.</div>
    {:else}
      <ul class="divide-y divide-white/5">
        {#each collaborators as collab (collab.userId)}
          <li class="px-3 py-2 flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-slate-300 truncate">{collab.name}</p>
              <p class="text-xs text-slate-500 truncate">{collab.email}</p>
            </div>
            <!-- Role selector -->
            <select
              class="text-xs bg-slate-700 border border-white/10 rounded px-1.5 py-0.5 {roleColor(collab.role)} focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={collab.role}
              onchange={(e) => handleRoleChange(collab.userId, (e.target as HTMLSelectElement).value)}
            >
              {#each ROLES as r (r)}
                <option value={r}>{r}</option>
              {/each}
            </select>
            <!-- Remove button -->
            <button
              class="text-xs text-slate-500 hover:text-red-400 transition-colors shrink-0 leading-none"
              onclick={() => handleRemove(collab.userId)}
              aria-label="Remove collaborator"
            >×</button>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- Invite form -->
  <form onsubmit={handleInvite} class="shrink-0 border-t border-white/10 p-3 flex flex-col gap-2">
    <input
      bind:value={inviteEmail}
      placeholder="user@example.com"
      type="email"
      class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
    <select
      bind:value={inviteRole}
      class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
    >
      <option value="viewer">Viewer — read-only</option>
      <option value="commenter">Commenter — can comment</option>
      <option value="editor">Editor — can edit</option>
    </select>
    <Button type="submit" size="sm" loading={inviting} disabled={!inviteEmail.trim()}>
      Invite
    </Button>
  </form>
</div>
