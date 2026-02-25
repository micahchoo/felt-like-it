<script lang="ts">
  import { trpc } from '$lib/utils/trpc.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import Modal from '$lib/components/ui/Modal.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  interface Props {
    mapId: string;
    open: boolean;
    onclose: () => void;
  }

  interface ShareRecord {
    id: string;
    mapId: string;
    token: string;
    accessLevel: string;
    createdAt: Date;
    updatedAt: Date;
  }

  let { mapId, open = $bindable(), onclose }: Props = $props();

  let share = $state<ShareRecord | null>(null);
  let loading = $state(false);
  let creating = $state(false);
  let deleting = $state(false);

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

  $effect(() => {
    if (open) {
      loadShare();
    }
  });

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

  async function copyToClipboard(text: string, label: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      toastStore.success(`${label} copied!`);
    } catch {
      toastStore.error('Failed to copy to clipboard.');
    }
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
          <Button size="sm" onclick={() => copyToClipboard(shareUrl, 'Share link')}>
            Copy
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
          <Button size="sm" onclick={() => copyToClipboard(embedSnippet, 'Embed code')}>
            Copy
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
        Create a public share link so anyone can view this map without signing in.
      </p>
      <Button variant="primary" onclick={createShare} loading={creating}>
        Create share link
      </Button>
    </div>
  {/if}
</Modal>
