<script lang="ts">
  import { trpc } from '$lib/utils/trpc.js';
  import { createQuery } from '@tanstack/svelte-query';
  import { queryKeys } from '$lib/utils/query-keys.js';
  import AnnotationContent from './AnnotationContent.svelte';

  interface Props {
    annotationId: string;
    userId?: string;
    ondelete: (id: string) => void;
  }

  let { annotationId, userId, ondelete }: Props = $props();

  const threadQuery = createQuery(() => ({
    queryKey: queryKeys.annotations.thread({ annotationId }),
    queryFn: () => trpc.annotations.getThread.query({ rootId: annotationId }),
  }));
</script>

<div class="ml-4 mt-2 space-y-2 border-l border-white/10 pl-3">
  {#if $threadQuery.isLoading}
    <p class="text-xs text-slate-500">Loading replies…</p>
  {:else if $threadQuery.isError}
    <p class="text-xs text-red-400">Failed to load replies.</p>
  {:else if $threadQuery.data?.replies.length}
    {#each $threadQuery.data.replies as reply (reply.id)}
      <div class="group flex items-start gap-2">
        <div class="flex-1 min-w-0">
          <AnnotationContent
            content={reply.content}
            authorName={reply.authorName ?? 'Unknown'}
            createdAt={reply.createdAt}
          />
        </div>
        {#if userId && reply.authorId === userId}
          <button
            onclick={() => ondelete(reply.id)}
            class="shrink-0 text-xs text-red-400/60 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            title="Delete reply"
          >
            Delete
          </button>
        {/if}
      </div>
    {/each}
  {:else}
    <p class="text-xs text-slate-500 italic">No replies yet.</p>
  {/if}
</div>
