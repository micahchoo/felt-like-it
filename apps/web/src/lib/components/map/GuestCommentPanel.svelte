<script lang="ts">
  import { trpc } from '$lib/utils/trpc.js';
  import Button from '$lib/components/ui/Button.svelte';
  import { toastStore } from '$lib/components/ui/Toast.svelte';

  interface Props {
    shareToken: string;
  }

  /** Comment shape from tRPC comments.listForShare. */
  interface CommentEntry {
    id: string;
    mapId: string;
    userId: string | null;
    authorName: string;
    body: string;
    resolved: boolean;
    createdAt: Date;
    updatedAt: Date;
  }

  let { shareToken }: Props = $props();

  let comments = $state<CommentEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let newBody = $state('');
  let authorName = $state('');
  let submitting = $state(false);

  async function loadComments() {
    loading = true;
    error = null;
    try {
      const rows = await trpc.comments.listForShare.query({ shareToken });
      comments = rows as CommentEntry[];
    } catch {
      error = 'Could not load comments.';
    } finally {
      loading = false;
    }
  }

  $effect(() => { loadComments(); });

  async function handleSubmit(e: Event) {
    e.preventDefault();
    const body = newBody.trim();
    const name = authorName.trim();
    if (!body || !name) return;
    submitting = true;
    try {
      await trpc.comments.createForShare.mutate({ shareToken, authorName: name, body });
      newBody = '';
      toastStore.success('Comment posted.');
      await loadComments();
    } catch {
      error = 'Failed to post comment.';
    } finally {
      submitting = false;
    }
  }

  function relativeTime(date: Date): string {
    const sec = Math.floor((Date.now() - date.getTime()) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  }
</script>

<div class="flex flex-col h-full bg-surface-container border-l border-white/5">
  <!-- Header -->
  <div class="px-3 py-2 border-b border-white/5 shrink-0 flex items-center gap-2">
    <span class="text-xs font-semibold text-on-surface-variant uppercase tracking-wide flex-1">Comments</span>
    {#if comments.length > 0}
      <span class="text-xs text-on-surface-variant/70">{comments.length}</span>
    {/if}
  </div>

  <!-- Comment list -->
  <div class="flex-1 overflow-y-auto min-h-0">
    {#if loading}
      <div class="flex items-center justify-center h-16 text-on-surface-variant/70 text-xs">Loading…</div>
    {:else if error}
      <div class="px-3 py-2 text-red-400 text-xs">{error}</div>
    {:else if comments.length === 0}
      <div class="flex items-center justify-center h-16 text-on-surface-variant/70 text-xs">No comments yet.</div>
    {:else}
      <ul class="divide-y divide-white/5">
        {#each comments as comment (comment.id)}
          <li class="px-3 py-2 {comment.resolved ? 'opacity-50' : ''}">
            <div class="flex items-center gap-1 mb-1">
              <span class="text-xs font-medium text-on-surface truncate flex-1">{comment.authorName}</span>
              <span class="text-xs text-on-surface-variant/70 shrink-0">{relativeTime(comment.createdAt)}</span>
              {#if comment.resolved}
                <span class="text-xs text-green-500 shrink-0">✓ resolved</span>
              {/if}
            </div>
            <p class="text-xs text-on-surface leading-relaxed whitespace-pre-wrap break-words">{comment.body}</p>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- New comment form -->
  <form onsubmit={handleSubmit} class="shrink-0 border-t border-white/5 p-3 flex flex-col gap-2">
    <input
      bind:value={authorName}
      placeholder="Your name"
      type="text"
      class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
    />
    <p class="mt-1 text-xs text-on-surface-variant">Your name will be visible to anyone with this link.</p>
    <textarea
      bind:value={newBody}
      placeholder="Write a comment..."
      rows={3}
      class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
    ></textarea>
    <Button type="submit" size="sm" loading={submitting} disabled={!newBody.trim() || !authorName.trim()}>
      Post
    </Button>
  </form>
</div>
