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
  let collabLoading = $state(true);
  let collabError = $state<string | null>(null);
  let inviteEmail = $state('');
  let inviteRole = $state<'viewer' | 'commenter' | 'editor'>('viewer');
  let inviting = $state(false);

  const ROLES = ['viewer', 'commenter', 'editor'] as const;

  $effect(() => {
    if (open) {
      collabError = null;
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
      toastStore.success('Collaborator added.');
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
      toastStore.success('Collaborator removed.');
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
      toastStore.success('Role updated.');
    } catch {
      collabError = 'Failed to update role.';
    }
  }

  function roleColor(role: string): string {
    if (role === 'editor') return 'text-primary';
    if (role === 'commenter') return 'text-yellow-400';
    return 'text-on-surface-variant';
  }
</script>

<Modal {open} title="Share map" {onclose}>
  <!-- Collaborators section -->
  <div class="flex flex-col gap-0">
    <p class="text-[10px] font-bold text-primary uppercase tracking-widest mb-3">Collaborators</p>

    {#if collabLoading}
      <div class="flex flex-col gap-2 mb-3">
        <div class="animate-pulse bg-surface-low rounded-lg h-10"></div>
        <div class="animate-pulse bg-surface-low rounded-lg h-10"></div>
        <div class="animate-pulse bg-surface-low rounded-lg h-10"></div>
      </div>
    {:else if collabError}
      <div class="text-red-400 text-xs mb-2">{collabError}</div>
    {:else if collaborators.length === 0}
      <div class="flex items-center justify-center h-16 text-on-surface-variant/70 text-xs">
        Invite others by email to view, comment on, or edit this map.
      </div>
    {:else}
      <ul class="divide-y divide-white/5 mb-3">
        {#each collaborators as collab (collab.userId)}
          <li class="py-2.5 flex items-center gap-3">
            <!-- Avatar -->
            <div class="w-7 h-7 rounded-full bg-surface-low border border-white/5 flex items-center justify-center shrink-0">
              <span class="text-[10px] font-bold text-on-surface-variant uppercase">
                {(collab.name || collab.email).charAt(0)}
              </span>
            </div>
            <!-- Name + email -->
            <div class="flex-1 min-w-0">
              <p class="text-sm text-on-surface truncate">{collab.name}</p>
              <p class="text-xs text-on-surface-variant truncate">{collab.email}</p>
            </div>
            {#if isOwner}
              <!-- Role dropdown (owner only) -->
              <select
                class="text-[10px] font-bold uppercase tracking-wider bg-surface-low border border-white/5 rounded px-2 py-1 {roleColor(collab.role)} focus:outline-none focus:ring-1 focus:ring-primary"
                value={collab.role}
                title={collab.role === 'owner' ? 'Full control — can edit, share, and delete' : collab.role === 'editor' ? 'Can edit layers, features, and annotations' : collab.role === 'commenter' ? 'Can view and add comments' : 'Can view the map only'}
                onchange={(e) => handleRoleChange(collab.userId, (e.target as HTMLSelectElement).value)}
              >
                <option value="viewer" title="Can view the map only">viewer</option>
                <option value="commenter" title="Can view and add comments">commenter</option>
                <option value="editor" title="Can edit layers, features, and annotations">editor</option>
              </select>
              <!-- Remove button (owner only) -->
              <button
                class="text-xs text-on-surface-variant/50 hover:text-red-400 transition-colors shrink-0 leading-none px-1"
                onclick={() => handleRemove(collab.userId)}
                aria-label="Remove collaborator"
              >×</button>
            {:else}
              <span
                class="text-[10px] font-bold uppercase tracking-wider {roleColor(collab.role)}"
                title={collab.role === 'owner' ? 'Full control — can edit, share, and delete' : collab.role === 'editor' ? 'Can edit layers, features, and annotations' : collab.role === 'commenter' ? 'Can view and add comments' : 'Can view the map only'}
              >{collab.role}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}

    <!-- Invite form (owner only) -->
    {#if isOwner}
      <form onsubmit={handleInvite} class="flex flex-col gap-2 pt-1">
        <div class="flex gap-2">
          <input
            bind:value={inviteEmail}
            placeholder="user@example.com"
            type="email"
            class="flex-1 rounded-lg bg-surface-low border border-white/5 px-3 py-2 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <select
            bind:value={inviteRole}
            class="rounded-lg bg-surface-low border border-white/5 px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
          >
            <option value="viewer">Viewer — can view</option>
            <option value="commenter">Commenter — can view & comment</option>
            <option value="editor">Editor — can view & edit</option>
          </select>
          <button
            type="submit"
            disabled={inviting || !inviteEmail.trim()}
            class="bg-primary text-on-primary text-[10px] font-bold uppercase tracking-wider rounded-lg px-3 py-2 transition-opacity disabled:opacity-40"
          >
            {inviting ? '…' : 'Invite'}
          </button>
        </div>
      </form>
    {/if}
  </div>

  <!-- Public access section -->
  <div class="border-t border-white/5 mt-5 pt-5 flex flex-col gap-3">
    <p class="text-[10px] font-bold text-primary uppercase tracking-widest">Public Access</p>

    {#if loading}
      <div class="flex items-center justify-center py-4">
        <span class="text-xs text-on-surface-variant">Loading...</span>
      </div>
    {:else if share}
      <!-- Share URL -->
      <div>
        <p class="text-xs font-semibold text-on-surface mb-1.5">Share link</p>
        <div class="flex gap-2">
          <input
            id="share-url"
            type="text"
            readonly
            value={shareUrl}
            class="flex-1 rounded-lg bg-surface-low border border-white/5 px-3 py-2 text-xs text-on-surface font-mono select-all focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onclick={() => copyToClipboard(shareUrl, 'Share link', 'url')}
            class="bg-primary text-on-primary text-[10px] font-bold uppercase tracking-wider rounded-lg px-3 py-2 transition-opacity shrink-0"
          >
            {copiedKey === 'url' ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <!-- Embed snippet -->
      <div>
        <p class="text-xs font-semibold text-on-surface mb-1.5">Embed code</p>
        <div class="flex gap-2">
          <input
            id="embed-snippet"
            type="text"
            readonly
            value={embedSnippet}
            class="flex-1 rounded-lg bg-surface-low border border-white/5 px-3 py-2 text-xs text-on-surface font-mono select-all focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <button
            onclick={() => copyToClipboard(embedSnippet, 'Embed code', 'embed')}
            class="bg-primary text-on-primary text-[10px] font-bold uppercase tracking-wider rounded-lg px-3 py-2 transition-opacity shrink-0"
          >
            {copiedKey === 'embed' ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <!-- Disable public access -->
      <div class="flex items-center justify-between pt-1">
        <p class="text-xs text-on-surface-variant">Anyone with the link can view this map.</p>
        <Button variant="danger" size="sm" onclick={deleteShare} loading={deleting}>
          Remove link
        </Button>
      </div>
    {:else}
      <div class="flex items-center justify-between">
        <p class="text-xs text-on-surface-variant">Create a public link — no login required.</p>
        <button
          onclick={createShare}
          disabled={creating}
          class="bg-primary text-on-primary text-[10px] font-bold uppercase tracking-wider rounded-lg px-3 py-2 transition-opacity disabled:opacity-40"
        >
          {creating ? '…' : 'Enable'}
        </button>
      </div>
    {/if}
  </div>
</Modal>
