<script lang="ts">
  import { trpc } from '$lib/utils/trpc.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  interface Props {
    mapId: string;
    open: boolean;
    onclose: () => void;
    isOwner?: boolean;
    userId?: string;
  }

  interface ShareRecord {
    id: string;
    mapId: string;
    token: string;
    accessLevel: string;
    createdAt: Date;
    updatedAt: Date;
  }

  /** Collaborator shape from tRPC collaborators.list. */
  interface CollaboratorEntry {
    id: string;
    mapId: string;
    userId: string;
    role: string;
    invitedBy: string | null;
    createdAt: Date;
    email: string;
    name: string;
  }

  let { mapId, open = $bindable(), onclose, isOwner = false, userId }: Props = $props();

  // ── Share state ─────────────────────────────────────────────────────────────
  let share = $state<ShareRecord | null>(null);
  let loading = $state(false);
  let creating = $state(false);
  let deleting = $state(false);
  let copiedKey = $state<string | null>(null);

  const shareUrl = $derived(
    share ? `${window.location.origin}/share/${share.token}` : ''
  );
  const embedUrl = $derived(
    share ? `${window.location.origin}/embed/${share.token}` : ''
  );
  const embedSnippet = $derived(
    share
      ? `<iframe src="${embedUrl}" width="800" height="600" frameborder="0" allowfullscreen></iframe>`
      : ''
  );

  // ── Collaborator state ──────────────────────────────────────────────────────
  let collaborators = $state<CollaboratorEntry[]>([]);
  let collabLoading = $state(false);
  let collabError = $state<string | null>(null);
  let inviteEmail = $state('');
  let inviteRole = $state<'viewer' | 'commenter' | 'editor'>('viewer');
  let inviting = $state(false);

  const ROLES = ['viewer', 'commenter', 'editor'] as const;

  $effect(() => {
    if (open) {
      loadShare();
      loadCollaborators();
    }
  });

  // ── Share functions ─────────────────────────────────────────────────────────
  async function loadShare(): Promise<void> {
    loading = true;
    try {
      const result = await trpc.shares.getForMap.query({ mapId });
      share = (result as ShareRecord) ?? null;
    } catch {
      share = null;
    } finally {
      loading = false;
    }
  }

  async function createShare(): Promise<void> {
    creating = true;
    try {
      const result = await trpc.shares.create.mutate({
        mapId,
        accessLevel: 'public',
      });
      share = result as ShareRecord;
      toastStore.success('Share link created.');
    } catch {
      toastStore.error('Failed to create share link.');
    } finally {
      creating = false;
    }
  }

  async function deleteShare(): Promise<void> {
    if (!window.confirm('Remove the public share link? Anyone using it will lose access.')) return;
    deleting = true;
    try {
      await trpc.shares.delete.mutate({ mapId });
      share = null;
      toastStore.success('Share link removed.');
    } catch {
      toastStore.error('Failed to remove share link.');
    } finally {
      deleting = false;
    }
  }

  async function copyToClipboard(text: string, label: string, key: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toastStore.success(`${label} copied!`);
      copiedKey = key;
      setTimeout(() => { copiedKey = null; }, 2000);
    } catch {
      toastStore.error('Failed to copy to clipboard.');
    }
  }

  // ── Collaborator functions ──────────────────────────────────────────────────
  async function loadCollaborators(): Promise<void> {
    collabLoading = true;
    collabError = null;
    try {
      const rows = await trpc.collaborators.list.query({ mapId });
      collaborators = rows as CollaboratorEntry[];
    } catch {
      collabError = 'Could not load collaborators.';
    } finally {
      collabLoading = false;
    }
  }

  async function handleInvite(e: Event): Promise<void> {
    e.preventDefault();
    const email = inviteEmail.trim();
    if (!email) return;
    inviting = true;
    collabError = null;
    try {
      await trpc.collaborators.invite.mutate({ mapId, email, role: inviteRole });
      inviteEmail = '';
      await loadCollaborators();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message;
      collabError = msg ?? 'Failed to invite collaborator.';
    } finally {
      inviting = false;
    }
  }

  async function handleRemove(collabUserId: string): Promise<void> {
    const collab = collaborators.find((c) => c.userId === collabUserId);
    const name = collab?.name ?? collab?.email ?? 'this collaborator';
    if (!window.confirm(`Remove ${name} from this map?`)) return;
    collabError = null;
    try {
      await trpc.collaborators.remove.mutate({ mapId, userId: collabUserId });
      collaborators = collaborators.filter((c) => c.userId !== collabUserId);
    } catch {
      collabError = 'Failed to remove collaborator.';
    }
  }

  async function handleRoleChange(collabUserId: string, role: string): Promise<void> {
    collabError = null;
    try {
      await trpc.collaborators.updateRole.mutate({
        mapId,
        userId: collabUserId,
        role: role as 'viewer' | 'commenter' | 'editor',
      });
      collaborators = collaborators.map((c) => (c.userId === collabUserId ? { ...c, role } : c));
    } catch {
      collabError = 'Failed to update role.';
    }
  }

  function roleColor(role: string): string {
    if (role === 'editor') return 'text-blue-400';
    if (role === 'commenter') return 'text-yellow-400';
    return 'text-slate-400';
  }
</script>

<Modal {open} title="Share map" {onclose}>
  {#if loading}
    <div class="flex items-center justify-center py-8">
      <span class="text-sm text-slate-400">Loading...</span>
    </div>
  {:else if share}
    <div class="flex flex-col gap-4">
      <!-- Share URL -->
      <div>
        <label for="share-url" class="block text-xs font-medium text-slate-400 mb-1">Share link</label>
        <div class="flex gap-2">
          <input
            id="share-url"
            type="text"
            readonly
            value={shareUrl}
            class="flex-1 rounded bg-slate-700 border border-white/10 px-3 py-2 text-sm text-slate-200 select-all focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <Button size="sm" onclick={() => copyToClipboard(shareUrl, 'Share link', 'url')}>
            {copiedKey === 'url' ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>

      <!-- Embed snippet -->
      <div>
        <label for="embed-snippet" class="block text-xs font-medium text-slate-400 mb-1">Embed code</label>
        <div class="flex gap-2">
          <input
            id="embed-snippet"
            type="text"
            readonly
            value={embedSnippet}
            class="flex-1 rounded bg-slate-700 border border-white/10 px-3 py-2 text-sm text-slate-200 font-mono select-all focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <Button size="sm" onclick={() => copyToClipboard(embedSnippet, 'Embed code', 'embed')}>
            {copiedKey === 'embed' ? 'Copied!' : 'Copy'}
          </Button>
        </div>
      </div>

      <!-- Delete share -->
      <div class="border-t border-white/10 pt-4">
        <div class="flex items-center justify-between">
          <p class="text-xs text-slate-400">
            Anyone with the link can view this map.
          </p>
          <Button variant="danger" size="sm" onclick={deleteShare} loading={deleting}>
            Remove link
          </Button>
        </div>
      </div>
    </div>
  {:else}
    <div class="flex flex-col items-center gap-4 py-4">
      <p class="text-sm text-slate-300 text-center">
        Create a public link to share this map with anyone — no login required.
      </p>
      <Button variant="primary" onclick={createShare} loading={creating}>
        Create share link
      </Button>
    </div>
  {/if}

  <!-- Collaborators section -->
  <div class="border-t border-white/10 mt-6 pt-4">
    <div class="flex items-center gap-2 mb-3">
      <h3 class="text-xs font-semibold text-slate-400 uppercase tracking-wide flex-1">Collaborators</h3>
      {#if collaborators.length > 0}
        <span class="text-xs text-slate-500">{collaborators.length}</span>
      {/if}
    </div>

    {#if collabLoading}
      <div class="flex items-center justify-center h-16 text-slate-500 text-xs">Loading…</div>
    {:else if collabError}
      <div class="text-red-400 text-xs mb-2">{collabError}</div>
    {:else if collaborators.length === 0}
      <div class="flex items-center justify-center h-16 text-slate-500 text-xs">
        Invite others by email to view, comment on, or edit this map.
      </div>
    {:else}
      <ul class="divide-y divide-white/5 mb-3">
        {#each collaborators as collab (collab.userId)}
          <li class="py-2 flex items-center gap-2">
            <div class="flex-1 min-w-0">
              <p class="text-xs font-medium text-slate-300 truncate">{collab.name}</p>
              <p class="text-xs text-slate-500 truncate">{collab.email}</p>
            </div>
            {#if isOwner}
              <!-- Role selector (owner only) -->
              <select
                class="text-xs bg-slate-700 border border-white/10 rounded px-1.5 py-0.5 {roleColor(collab.role)} focus:outline-none focus:ring-1 focus:ring-blue-500"
                value={collab.role}
                onchange={(e) => handleRoleChange(collab.userId, (e.target as HTMLSelectElement).value)}
              >
                {#each ROLES as r (r)}
                  <option value={r}>{r}</option>
                {/each}
              </select>
              <!-- Remove button (owner only) -->
              <button
                class="text-xs text-slate-500 hover:text-red-400 transition-colors shrink-0 leading-none"
                onclick={() => handleRemove(collab.userId)}
                aria-label="Remove collaborator"
              >×</button>
            {:else}
              <span class="text-xs {roleColor(collab.role)}">{collab.role}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Invite form (owner only) -->
    {#if isOwner}
      <form onsubmit={handleInvite} class="flex flex-col gap-2 pt-2">
        <input
          bind:value={inviteEmail}
          placeholder="user@example.com"
          type="email"
          class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div class="flex gap-2">
          <select
            bind:value={inviteRole}
            class="flex-1 rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="viewer">Viewer — can view the map and all data (read-only)</option>
            <option value="commenter">Commenter — can view and add comments/annotations</option>
            <option value="editor">Editor — can view, comment, draw, import data, and edit features</option>
          </select>
          <Button type="submit" size="sm" loading={inviting} disabled={!inviteEmail.trim()}>
            Invite
          </Button>
        </div>
      </form>
    {/if}
  </div>
</Modal>
