<script lang="ts">
  import type { AnnotationObject } from '@felt-like-it/shared-types';
  import AnnotationContent from './AnnotationContent.svelte';
  import AnnotationThread from './AnnotationThread.svelte';
  import Button from '$lib/components/ui/Button.svelte';

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

  interface Props {
    annotations: AnnotationObject[];
    comments: CommentEntry[];
    userId?: string | undefined;
    expandedAnnotationId: string | null;
    replyingTo: string | null;
    replyText: string;
    listLoading: boolean;
    listError: string | null;
    /** True while any list-scoped mutation is in flight — disables action buttons. */
    isMutating?: boolean;
    onexpand: (id: string | null) => void;
    onreplying: (id: string | null) => void;
    onreplytext: (text: string) => void;
    onreply: (annotationId: string) => void;
    ondelete: (id: string) => void;
    onedit?: (annotation: AnnotationObject, newText: string) => void;
    onconverttopoint: (annotation: AnnotationObject) => void;
    onfetchnavplace: (annotation: AnnotationObject) => void;
  }

  let {
    annotations,
    comments,
    userId,
    expandedAnnotationId,
    replyingTo,
    replyText,
    listLoading,
    listError,
    isMutating = false,
    onexpand,
    onreplying,
    onreplytext,
    onreply,
    ondelete,
    onedit,
    onconverttopoint,
    onfetchnavplace,
  }: Props = $props();

  let editingId = $state<string | null>(null);
  let editText = $state('');
</script>

{#if listLoading}
  <p class="text-xs text-on-surface-variant/70 text-center py-6">Loading…</p>
{:else if listError}
  <p class="text-xs text-red-400 px-3 py-4">{listError}</p>
{:else if annotations.length === 0 && comments.length === 0}
  <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
    <svg
      class="h-6 w-6 text-on-surface-variant/70 mb-2"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        d="M8 1a6 6 0 100 12A6 6 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3a1 1 0 011 1v2h2a1 1 0 010 2H9v2a1 1 0 01-2 0v-2H5a1 1 0 010-2h2V6a1 1 0 011-1z"
      />
    </svg>
    <p class="text-sm text-on-surface-variant">
      No annotations yet. Click the map to add a note, or pick a feature to annotate it.
    </p>
  </div>
{:else}
  {#each annotations as annotation (annotation.id)}
    <div id="annotation-{annotation.id}" class="px-3 py-3 border-b border-white/5 space-y-2">
      {#if annotation.name}
        <h4 class="text-sm font-semibold text-on-surface truncate" title={annotation.name}>
          {annotation.name}
        </h4>
      {/if}
      {#if annotation.description}
        <p class="text-xs text-on-surface-variant/90 whitespace-pre-wrap">
          {annotation.description}
        </p>
      {/if}
      <AnnotationContent
        content={annotation.content}
        authorName={annotation.authorName}
        createdAt={annotation.createdAt}
        featureDeleted={annotation.anchor.type === 'feature' &&
          annotation.anchor.featureDeleted === true}
        onconverttopoint={annotation.anchor.type === 'feature' &&
        annotation.anchor.featureDeleted === true
          ? () => {
              const coords: [number, number] =
                annotation.anchor.type === 'feature' &&
                'geometry' in annotation.anchor &&
                annotation.anchor.geometry
                  ? (annotation.anchor.geometry as { type: string; coordinates: [number, number] })
                      .coordinates
                  : [0, 0];
              onconverttopoint(annotation);
            }
          : undefined}
      />

      {#if annotation.anchor.type === 'viewport'}
        <span class="text-[10px] bg-amber-100/10 text-amber-400 px-1.5 py-0.5 rounded"
          >Map-level</span
        >
      {:else if annotation.anchor.type === 'region'}
        <span class="text-[10px] bg-tertiary/10 text-tertiary px-1.5 py-0.5 rounded">Region</span>
      {/if}

      <!-- Thread controls -->
      <div class="flex gap-2 text-xs">
        <button
          onclick={() => {
            onexpand(expandedAnnotationId === annotation.id ? null : annotation.id);
          }}
          class="text-on-surface-variant hover:text-on-surface"
        >
          {expandedAnnotationId === annotation.id ? 'Collapse' : 'Replies'}
        </button>
        {#if annotation.authorId === userId || userId}
          <button
            onclick={() => {
              onreplying(replyingTo === annotation.id ? null : annotation.id);
              onreplytext('');
            }}
            class="text-primary hover:text-primary/80"
          >
            Reply
          </button>
        {/if}
      </div>

      <!-- Thread replies -->
      {#if expandedAnnotationId === annotation.id}
        <AnnotationThread annotationId={annotation.id} {userId} {ondelete} />
      {/if}

      <!-- Reply form -->
      {#if replyingTo === annotation.id}
        <div class="ml-4 mt-1 flex gap-1">
          <textarea
            bind:value={replyText}
            oninput={(e) => onreplytext((e.target as HTMLTextAreaElement).value)}
            placeholder="Write a reply..."
            rows={2}
            class="flex-1 rounded bg-surface-low border border-white/5 px-2 py-1 text-xs text-on-surface placeholder-on-surface-variant/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          ></textarea>
          <Button
            size="sm"
            disabled={!replyText.trim() || isMutating}
            onclick={() => onreply(annotation.id)}
          >
            Send
          </Button>
        </div>
      {/if}

      <!-- Inline edit form (text content only — other content types are read-only from the list) -->
      {#if editingId === annotation.id && annotation.content.kind === 'single' && annotation.content.body.type === 'text'}
        <div class="mt-1 flex gap-1">
          <textarea
            bind:value={editText}
            placeholder="Edit your note…"
            rows={2}
            class="flex-1 rounded bg-surface-low border border-white/5 px-2 py-1 text-xs text-on-surface placeholder-on-surface-variant/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
          ></textarea>
          <Button
            size="sm"
            disabled={!editText.trim() || isMutating}
            onclick={() => {
              onedit?.(annotation, editText.trim());
              editingId = null;
              editText = '';
            }}
          >
            Save
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onclick={() => {
              editingId = null;
              editText = '';
            }}
          >
            Cancel
          </Button>
        </div>
      {/if}

      <!-- Per-annotation actions -->
      <div class="flex gap-2">
        {#if annotation.anchor.type === 'feature' && annotation.anchor.featureDeleted === true}
          <button
            onclick={() => onconverttopoint(annotation)}
            class="text-xs text-amber-400 hover:text-amber-300 underline"
            disabled={isMutating}
          >
            📍 Convert to map pin
          </button>
        {/if}
        {#if annotation.content.kind === 'single' && annotation.content.body.type === 'iiif' && !annotation.content.body.navPlace && annotation.authorId === userId}
          <button
            onclick={() => onfetchnavplace(annotation)}
            class="text-xs text-amber-400 hover:text-amber-300 underline"
            disabled={isMutating}
          >
            Fetch NavPlace
          </button>
        {/if}
        {#if annotation.authorId === userId && annotation.content.kind === 'single' && annotation.content.body.type === 'text'}
          <button
            onclick={() => {
              if (editingId === annotation.id) {
                editingId = null;
                editText = '';
              } else {
                editingId = annotation.id;
                editText =
                  annotation.content.kind === 'single' && annotation.content.body.type === 'text'
                    ? annotation.content.body.text
                    : '';
              }
            }}
            class="text-xs text-on-surface-variant hover:text-on-surface disabled:opacity-40"
            disabled={isMutating}
          >
            {editingId === annotation.id ? 'Close editor' : 'Edit'}
          </button>
        {/if}
        {#if annotation.authorId === userId}
          <button
            onclick={() => ondelete(annotation.id)}
            class="text-xs text-red-400 hover:text-red-300 ml-auto disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={isMutating}
          >
            Delete
          </button>
        {/if}
      </div>
    </div>
  {/each}
{/if}
