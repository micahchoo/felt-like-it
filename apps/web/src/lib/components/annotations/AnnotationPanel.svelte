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
    convertAnnotationsToLayerMutationOptions,
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
  const convertToLayer = createMutation(() =>
    convertAnnotationsToLayerMutationOptions({ queryClient, mapId })
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
    name?: string;
    description?: string;
  }) {
    // Idempotency guard — the mutation's `isPending` already drives the
    // submit button's disabled state, but a direct programmatic call via
    // keyboard shortcut or pending-measurement could still land while a
    // prior request is in flight. Swallow the second call.
    if (createAnnotation.isPending) return;
    try {
      await createAnnotation.mutateAsync(input);
      onannotationsaved('created');
    } catch {
      // mutation.onError already surfaced a user-facing toast
    }
  }

  async function handleDelete(id: string) {
    const target = annotations.find((a) => a.id === id);
    if (!target) return;
    if (deleteAnnotation.isPending) return;
    try {
      await deleteAnnotation.mutateAsync({ id, version: target.version });
      onannotationsaved('deleted');
    } catch {
      // mutation.onError already surfaced a user-facing toast (incl. CONFLICT)
    }
  }

  async function handleUpdate(input: {
    id: string;
    version: number;
    anchor?: Anchor;
    content?: { kind: 'single'; body: AC };
  }) {
    if (updateAnnotation.isPending) return;
    try {
      await updateAnnotation.mutateAsync(input);
    } catch {
      // mutation.onError already surfaced a user-facing toast (incl. CONFLICT)
    }
  }

  async function handleReply(parentId: string) {
    const body = replyText.trim();
    if (!body || !userId) return;
    if (replyAnnotation.isPending) return;
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
      // mutation.onError already surfaced a user-facing toast
    }
  }

  async function handlePromoteToLayer(annotationId: string) {
    if (convertToLayer.isPending) return;
    const target = annotations.find((a) => a.id === annotationId);
    if (!target) return;
    const suggested = target.name ?? 'Promoted annotation';
    const layerName = window.prompt('New layer name', suggested);
    if (!layerName || !layerName.trim()) return;
    try {
      const result = await convertToLayer.mutateAsync({
        mapId,
        annotationIds: [annotationId],
        layerName: layerName.trim(),
      });
      if (result.featureCount > 0) {
        toastStore.success(`Promoted to layer (${result.featureCount} feature).`);
        onannotationsaved('deleted');
      } else if (result.skipped.length > 0) {
        toastStore.error(result.skipped[0]?.reason ?? 'Nothing to convert.');
      }
    } catch {
      // mutation.onError already surfaced a user-facing toast
    }
  }

  async function handleConvertToPoint(annotation: { id: string }) {
    // Use first annotation's coordinates if available
    const ann = annotations.find((a) => a.id === annotation.id);
    if (!ann) return;
    let coords: [number, number] = [0, 0];
    if (ann.anchor?.type === 'point') {
      const pt = ann.anchor.geometry.coordinates;
      coords = [pt[0], pt[1]];
    } else if (ann.anchor?.type === 'region') {
      const firstRing = ann.anchor.geometry.coordinates[0];
      const firstVertex = firstRing?.[0];
      if (firstVertex) coords = [firstVertex[0], firstVertex[1]];
    }
    try {
      await convertToPoint.mutateAsync({
        mapId,
        annotationId: annotation.id,
        coordinates: coords,
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
  const submittingComment = $derived(createComment.isPending);

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
      isSubmitting={createAnnotation.isPending}
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
      onedit={(annotation, newText) => {
        handleUpdate({
          id: annotation.id,
          version: annotation.version,
          content: { kind: 'single', body: { type: 'text', text: newText } },
        });
      }}
      isMutating={deleteAnnotation.isPending ||
        updateAnnotation.isPending ||
        replyAnnotation.isPending ||
        convertToLayer.isPending}
      onconverttopoint={handleConvertToPoint}
      onfetchnavplace={handleFetchNavPlace}
      onpromotetolayer={handlePromoteToLayer}
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
