<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { effectEnter, effectExit } from '$lib/debug/effect-tracker.js';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { queryKeys } from '$lib/utils/query-keys.js';
  import { trpc } from '$lib/utils/trpc.js';
  import type {
    AnnotationObject,
    Anchor,
    AnnotationContent as AC,
  } from '@felt-like-it/shared-types';
  import type { SaveAsAnnotationPayload } from '$lib/stores/measurement-store.svelte.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import AnnotationForm from './AnnotationForm.svelte';
  import AnnotationList from './AnnotationList.svelte';
  import {
    createAnnotationMutationOptions,
    deleteAnnotationMutationOptions,
    updateAnnotationMutationOptions,
    replyAnnotationMutationOptions,
    convertToPointMutationOptions,
    createCommentMutationOptions,
    deleteCommentMutationOptions,
    resolveCommentMutationOptions,
  } from './AnnotationMutations.js';

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
    mapId: string;
    userId?: string;
    onannotationsaved: (action?: 'created' | 'deleted') => void;
    onrequestregion?: () => void;
    onrequestfeaturepick?: () => void;
    regionGeometry?: { type: 'Polygon'; coordinates: number[][][] } | undefined;
    pickedFeature?: { featureId: string; layerId: string } | undefined;
    embedded?: boolean;
    pendingMeasurement?:
      | {
          anchor: {
            type: 'measurement';
            geometry:
              | { type: 'LineString'; coordinates: [number, number][] }
              | { type: 'Polygon'; coordinates: [number, number][][] };
          };
          content: {
            type: 'measurement';
            measurementType: 'distance' | 'area';
            value: number;
            unit: string;
            displayValue: string;
          };
        }
      | null
      | undefined;
    scrollToFeatureId?: string | null | undefined;
    oncountchange?: (annotationCount: number, commentCount: number) => void;
  }

  let {
    mapId,
    userId,
    onannotationsaved,
    onrequestregion = () => {},
    onrequestfeaturepick = () => {},
    regionGeometry = undefined,
    pickedFeature,
    pendingMeasurement,
    scrollToFeatureId,
    embedded,
    oncountchange,
  }: Props = $props();

  const queryClient = useQueryClient();

  // ── Data queries ────────────────────────────────────────────────────────────

  const annotationsQuery = createQuery(() => ({
    queryKey: queryKeys.annotations.list({ mapId }),
    queryFn: () => trpc.annotations.list.query({ mapId }),
    enabled: !!userId,
  }));
  const annotations = $derived(annotationsQuery.data ?? []);
  const listLoading = $derived(annotationsQuery.isPending);
  const listError = $derived(annotationsQuery.error?.message ?? null);

  const commentsQuery = createQuery(() => ({
    queryKey: queryKeys.comments.list({ mapId }),
    queryFn: async () => {
      const rows = await trpc.comments.list.query({ mapId });
      return rows as CommentEntry[];
    },
  }));
  const comments = $derived(commentsQuery.data ?? []);

  // ── Count change effect ─────────────────────────────────────────────────────

  let _prevAnnotationCount = -1;
  let _prevCommentCount = -1;
  $effect(() => {
    const a = annotations.length;
    const c = comments.length;
    effectEnter('AP:countChange', { annotations: a, comments: c });
    untrack(() => {
      if (a !== _prevAnnotationCount || c !== _prevCommentCount) {
        _prevAnnotationCount = a;
        _prevCommentCount = c;
        oncountchange?.(a, c);
      }
    });
    effectExit('AP:countChange');
  });

  // ── Mutation hooks ──────────────────────────────────────────────────────────

  const createAnnotation = createMutation(() =>
    createAnnotationMutationOptions({ queryClient, mapId })
  );
  const deleteAnnotation = createMutation(() =>
    deleteAnnotationMutationOptions({ queryClient, mapId })
  );
  const updateAnnotation = createMutation(() =>
    updateAnnotationMutationOptions({ queryClient, mapId })
  );
  const replyAnnotation = createMutation(() =>
    replyAnnotationMutationOptions({ queryClient, mapId })
  );
  const convertToPoint = createMutation(() =>
    convertToPointMutationOptions({ queryClient, mapId })
  );
  const createComment = createMutation(() => createCommentMutationOptions({ queryClient, mapId }));
  const deleteComment = createMutation(() => deleteCommentMutationOptions({ queryClient, mapId }));
  const resolveComment = createMutation(() =>
    resolveCommentMutationOptions({ queryClient, mapId })
  );

  // ── Local state ─────────────────────────────────────────────────────────────

  let selectedAnnotationId = $state<string | null>(null);
  let replyingTo = $state<string | null>(null);
  let replyText = $state('');

  // ── Handlers ────────────────────────────────────────────────────────────────

  async function handleCreate(input: {
    mapId: string;
    anchor: Anchor;
    content: { kind: 'single'; body: AC };
  }) {
    try {
      await createAnnotation.mutateAsync(input);
      onannotationsaved('created');
    } catch {
      toastStore.error('Failed to create annotation.');
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteAnnotation.mutateAsync({ id });
      onannotationsaved('deleted');
    } catch {
      toastStore.error('Failed to delete annotation.');
    }
  }

  async function handleReply(parentId: string) {
    const body = replyText.trim();
    if (!body || !userId) return;
    try {
      await replyAnnotation.mutateAsync({
        mapId,
        parentId,
        anchor: { type: 'viewport' },
        content: { kind: 'single', body: { type: 'text', text: body } },
      });
      replyText = '';
      replyingTo = null;
    } catch {
      toastStore.error('Failed to reply.');
    }
  }

  async function handleConvertToPoint(annotation: { id: string }) {
    // Use first annotation's coordinates if available
    const ann = annotations.find((a) => a.id === annotation.id);
    if (!ann) return;
    const coords =
      ann.anchor?.type === 'point'
        ? (ann.anchor as { coordinates: [number, number] }).coordinates
        : ann.anchor?.type === 'region'
          ? (ann.anchor.geometry as { coordinates: [[number, number]] }).coordinates[0][0]
          : [0, 0];
    try {
      await convertToPoint.mutateAsync({
        mapId,
        annotationId: annotation.id,
        coordinates: coords as [number, number],
      });
    } catch {
      toastStore.error('Failed to convert annotation to point.');
    }
  }

  async function handleFetchNavPlace(_annotation: { id: string }) {
    // Stub — original panel had this as a no-op or external call
  }

  async function handleCommentSubmit() {
    const body = commentBody.trim();
    if (!body) return;
    try {
      await createComment.mutateAsync({ mapId, body });
      commentBody = '';
    } catch {
      toastStore.error('Failed to post comment.');
    }
  }

  async function handleCommentDelete(id: string) {
    try {
      await deleteComment.mutateAsync({ id });
    } catch {
      toastStore.error('Failed to delete comment.');
    }
  }

  async function handleCommentResolve(id: string) {
    try {
      await resolveComment.mutateAsync({ id });
    } catch {
      toastStore.error('Failed to resolve comment.');
    }
  }

  // ── Comment state ───────────────────────────────────────────────────────────

  let commentBody = $state('');
  let submittingComment = $state(false);

  // ── Blob cleanup ────────────────────────────────────────────────────────────
  // (AnnotationForm handles its own blob cleanup internally)

  // ── Scroll to feature ───────────────────────────────────────────────────────

  $effect(() => {
    if (scrollToFeatureId) {
      tick().then(() => {
        // Scroll logic would go here if needed
      });
    }
  });

  // ── Pending measurement ─────────────────────────────────────────────────────

  let pendingMeasurementData = $state<SaveAsAnnotationPayload | null>(null);
  $effect(() => {
    if (pendingMeasurement) {
      pendingMeasurementData = {
        title: `Measurement: ${pendingMeasurement.content.measurementType}`,
        content: pendingMeasurement.content.displayValue,
        geometry: pendingMeasurement.anchor.geometry,
      };
    } else {
      pendingMeasurementData = null;
    }
  });
</script>

<div class="flex flex-col h-full">
  <!-- Form section -->
  <div class="border-b border-white/10 shrink-0">
    <AnnotationForm
      {mapId}
      oncreate={handleCreate}
      {pendingMeasurementData}
      {regionGeometry}
      {pickedFeature}
      {onrequestregion}
      {onrequestfeaturepick}
    />
  </div>

  <!-- List section -->
  <div class="flex-1 min-h-0 overflow-y-auto">
    <AnnotationList
      {annotations}
      {comments}
      {userId}
      expandedAnnotationId={selectedAnnotationId}
      {replyingTo}
      {replyText}
      {listLoading}
      {listError}
      onexpand={(id: string | null) => {
        selectedAnnotationId = selectedAnnotationId === id ? null : id;
      }}
      onreplying={(id: string | null) => {
        replyingTo = id;
      }}
      onreplytext={(text: string) => {
        replyText = text;
      }}
      onreply={() => handleReply(replyingTo!)}
      ondelete={handleDelete}
      onconverttopoint={handleConvertToPoint}
      onfetchnavplace={handleFetchNavPlace}
    />
  </div>

  <!-- Comment section -->
  <div class="border-t border-white/10 p-3 shrink-0">
    <form
      onsubmit={(e) => {
        e.preventDefault();
        handleCommentSubmit();
      }}
      class="flex gap-2"
    >
      <input
        type="text"
        bind:value={commentBody}
        placeholder="Add a comment..."
        class="flex-1 px-3 py-1.5 text-sm bg-surface-high/50 border border-white/10 rounded
               text-on-surface placeholder:text-on-surface-variant/40
               focus:outline-none focus:border-primary/50"
      />
      <button
        type="submit"
        disabled={!commentBody.trim() || submittingComment}
        class="px-3 py-1.5 text-xs font-medium bg-primary text-on-primary rounded
               disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors"
      >
        Post
      </button>
    </form>
  </div>
</div>
