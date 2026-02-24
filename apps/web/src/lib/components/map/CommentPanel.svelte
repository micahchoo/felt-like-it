<script lang="ts">
  import { trpc } from '$lib/utils/trpc.js';
  import Button from '$lib/components/ui/Button.svelte';

  interface Props {
    mapId: string;
    /** ID of the current authenticated user — gates delete and resolve buttons. */
    userId?: string;
  }

  /**
   * Comment shape from tRPC comments.list.
   * createdAt / updatedAt are ISO-8601 strings (tRPC JSON wire type).
   */
  interface CommentEntry {
    id: string;
    mapId: string;
    userId: string | null;
    authorName: string;
    body: string;
    resolved: boolean;
    createdAt: string;
    updatedAt: string;
  }

  let { mapId, userId }: Props = $props();

  let comments = $state<CommentEntry[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let newBody = $state('');
  let submitting = $state(false);

  async function loadComments() {
    loading = true;
    error = null;
    try {
      const rows = await trpc.comments.list.query({ mapId });
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
    if (!body) return;
    submitting = true;
    try {
      await trpc.comments.create.mutate({ mapId, body });
      newBody = '';
      await loadComments();
    } catch {
      error = 'Failed to post comment.';
    } finally {
      submitting = false;
    }
  }

  async function handleDelete(id: string) {
    try {
      await trpc.comments.delete.mutate({ id });
      comments = comments.filter((c) => c.id !== id);
    } catch {
      error = 'Failed to delete comment.';
    }
  }

  async function handleResolve(id: string) {
    try {
      const updated = await trpc.comments.resolve.mutate({ id });
      comments = comments.map((c) => (c.id === id ? (updated as CommentEntry) : c));
    } catch {
      error = 'Failed to update comment.';
    }
  }

  function relativeTime(date: string): string {
    const sec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
    if (sec < 60) return 'just now';
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
    return `${Math.floor(sec / 86400)}d ago`;
  }
</script>

<div class="flex flex-col h-full bg-slate-800 border-l border-white/10">
  <!-- Header -->
  <div class="px-3 py-2 border-b border-white/10 shrink-0 flex items-center gap-2">
    <span class="text-xs font-semibold text-slate-400 uppercase tracking-wide flex-1">Comments</span>
    {#if comments.length > 0}
      <span class="text-xs text-slate-500">{comments.length}</span>
    {/if}
  </div>

  <!-- Comment list -->
  <div class="flex-1 overflow-y-auto min-h-0">
    {#if loading}
      <div class="flex items-center justify-center h-16 text-slate-500 text-xs">Loading…</div>
    {:else if error}
      <div class="px-3 py-2 text-red-400 text-xs">{error}</div>
    {:else if comments.length === 0}
      <div class="flex items-center justify-center h-16 text-slate-500 text-xs">No comments yet.</div>
    {:else}
      <ul class="divide-y divide-white/5">
        {#each comments as comment (comment.id)}
          <li class="px-3 py-2 {comment.resolved ? 'opacity-50' : ''}">
            <!-- Meta row -->
            <div class="flex items-center gap-1 mb-1">
              <span class="text-xs font-medium text-slate-300 truncate flex-1">{comment.authorName}</span>
              <span class="text-xs text-slate-500 shrink-0">{relativeTime(comment.createdAt)}</span>
              {#if comment.resolved}
                <span class="text-xs text-green-500 shrink-0">✓ resolved</span>
              {/if}
            </div>

            <!-- Body -->
            <p class="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap break-words">{comment.body}</p>

            <!-- Actions -->
            <div class="flex gap-2 mt-1">
              <!-- Map owner can resolve / unresolve any comment -->
              <button
                class="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                onclick={() => handleResolve(comment.id)}
              >
                {comment.resolved ? 'Unresolve' : 'Resolve'}
              </button>

              <!-- Only the comment author can delete their own comment -->
              {#if comment.userId === userId}
                <button
                  class="text-xs text-slate-500 hover:text-red-400 transition-colors"
                  onclick={() => handleDelete(comment.id)}
                >
                  Delete
                </button>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <!-- New comment form -->
  <form onsubmit={handleSubmit} class="shrink-0 border-t border-white/10 p-3 flex flex-col gap-2">
    <textarea
      bind:value={newBody}
      placeholder="Leave a comment…"
      rows={3}
      class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
    ></textarea>
    <Button type="submit" size="sm" loading={submitting} disabled={!newBody.trim()}>
      Post
    </Button>
  </form>
</div>
