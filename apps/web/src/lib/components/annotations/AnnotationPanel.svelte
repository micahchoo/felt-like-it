<script lang="ts">
  import { tick, untrack } from 'svelte';
  import { effectEnter, effectExit } from '$lib/debug/effect-tracker.js';
  import exifr from 'exifr';
  import { trpc } from '$lib/utils/trpc.js';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { queryKeys } from '$lib/utils/query-keys.js';
  import Button from '$lib/components/ui/Button.svelte';
  import { Type, Smile, Film, ImageIcon, Link2, Waypoints } from 'lucide-svelte';
  import AnnotationContent from './AnnotationContent.svelte';
  import AnnotationThread from './AnnotationThread.svelte';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import type { AnnotationObject, AnnotationContent as AC, Anchor } from '@felt-like-it/shared-types';

  interface Props {
    mapId: string;
    /** Authenticated user id — used to gate edit / delete buttons. */
    userId?: string;
    /** Called after any mutation (create / delete) so the parent can refresh the map pins. */
    onannotationsaved: (action?: 'created' | 'deleted') => void;
    /** Called when the user wants to draw a region polygon on the map. */
    onrequestregion?: () => void;
    /** Called when the user selects "Feature" anchor — parent enters pick mode. */
    onrequestfeaturepick?: () => void;
    /** Polygon geometry drawn on the map, passed back by the parent. */
    regionGeometry?: { type: 'Polygon'; coordinates: number[][][] } | undefined;
    /** Feature picked by the user on the map (set by parent in pick mode). */
    pickedFeature?: { featureId: string; layerId: string } | undefined;
    embedded?: boolean;
    /** Pre-filled measurement data from the measure panel's "Save as annotation" button. */
    pendingMeasurement?: {
      anchor: {
        type: 'measurement';
        geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'Polygon'; coordinates: [number, number][][] };
      };
      content: {
        type: 'measurement';
        measurementType: 'distance' | 'area';
        value: number;
        unit: string;
        displayValue: string;
      };
    } | null | undefined;
    /** When set, scrolls to the first annotation anchored to this feature. */
    scrollToFeatureId?: string | null | undefined;
    /** Called when annotation or comment counts change. */
    oncountchange?: (annotationCount: number, commentCount: number) => void;
  }

  let { mapId, userId, onannotationsaved, onrequestregion, onrequestfeaturepick, regionGeometry = undefined, pickedFeature, pendingMeasurement, scrollToFeatureId, embedded, oncountchange }: Props = $props();

  const queryClient = useQueryClient();

  // ── Annotation list (TanStack Query) ─────────────────────────────────────

  const annotationsQuery = createQuery(() => ({
    queryKey: queryKeys.annotations.list({ mapId }),
    queryFn: () => trpc.annotations.list.query({ mapId }),
    enabled: !!userId, // Skip for unauthenticated guests (share/embed pages)
  }));

  const annotationList = $derived(annotationsQuery.data ?? []);
  const listLoading = $derived(annotationsQuery.isPending);
  const listError = $derived(annotationsQuery.error?.message ?? null);

  // ── Comment integration ───────────────────────────────────────────────
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

  const commentsQuery = createQuery(() => ({
    queryKey: queryKeys.comments.list({ mapId }),
    queryFn: async () => {
      const rows = await trpc.comments.list.query({ mapId });
      return rows as CommentEntry[];
    },
  }));

  const comments = $derived(commentsQuery.data ?? []);

  let commentBody = $state('');
  let submittingComment = $state(false);

  // Notify parent of count changes. Two guards prevent effect_update_depth_exceeded:
  //  1. untrack() the callback so the parent's new closure isn't a dependency.
  //  2. Previous-value check so the callback only fires when counts actually change,
  //     breaking the synchronous re-render cycle during initial map tile loading.
  let _prevAnnotationCount = -1;
  let _prevCommentCount = -1;
  $effect(() => {
    const a = annotationList.length;
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

  // ── Comment mutations (TanStack Query) ───────────────────────────────────

  const createCommentMutation = createMutation(() => ({
    mutationFn: (input: { mapId: string; body: string }) =>
      trpc.comments.create.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.comments.list({ mapId }) });
    },
  }));

  const deleteCommentMutation = createMutation(() => ({
    mutationFn: (input: { id: string }) => trpc.comments.delete.mutate(input),
    onMutate: async ({ id }: { id: string }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.comments.list({ mapId }) });
      const previous = queryClient.getQueryData<CommentEntry[]>(queryKeys.comments.list({ mapId }));
      queryClient.setQueryData<CommentEntry[]>(
        queryKeys.comments.list({ mapId }),
        (old) => old?.filter((c) => c.id !== id) ?? []
      );
      return { previous } as { previous?: CommentEntry[] };
    },
    onError: (_err: unknown, _vars: { id: string }, context: { previous?: CommentEntry[] } | undefined) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.comments.list({ mapId }), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.comments.list({ mapId }) });
    },
  }));

  const resolveCommentMutation = createMutation(() => ({
    mutationFn: (input: { id: string }) => trpc.comments.resolve.mutate(input),
    onMutate: async ({ id }: { id: string }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.comments.list({ mapId }) });
      const previous = queryClient.getQueryData<CommentEntry[]>(queryKeys.comments.list({ mapId }));
      queryClient.setQueryData<CommentEntry[]>(
        queryKeys.comments.list({ mapId }),
        (old) => old?.map((c) => c.id === id ? { ...c, resolved: !c.resolved } : c) ?? []
      );
      return { previous } as { previous?: CommentEntry[] };
    },
    onError: (_err: unknown, _vars: { id: string }, context: { previous?: CommentEntry[] } | undefined) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.comments.list({ mapId }), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.comments.list({ mapId }) });
    },
  }));

  async function handleCommentSubmit() {
    const body = commentBody.trim();
    if (!body) return;
    submittingComment = true;
    try {
      await createCommentMutation.mutateAsync({ mapId, body });
      commentBody = '';
    } catch {
      toastStore.error('Failed to post comment.');
    } finally {
      submittingComment = false;
    }
  }

  async function handleCommentDelete(id: string) {
    try {
      await deleteCommentMutation.mutateAsync({ id });
    } catch {
      toastStore.error('Failed to delete comment.');
    }
  }

  async function handleCommentResolve(id: string) {
    try {
      await resolveCommentMutation.mutateAsync({ id });
    } catch {
      toastStore.error('Failed to resolve comment.');
    }
  }

  // Cleanup blob URL on component unmount to prevent memory leaks
  $effect(() => {
    effectEnter('AP:blobCleanup');
    effectExit('AP:blobCleanup');
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  });

  // ── Create form ────────────────────────────────────────────────────────────

  type ContentType = AC['type'];

  const CONTENT_TYPES: ContentType[] = ['text', 'emoji', 'gif', 'image', 'link', 'iiif'];

  const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
    text:  'Text',
    emoji: 'Emoji',
    gif:   'GIF',
    image: 'Image',
    link:  'Link',
    iiif:  'IIIF',
    measurement: 'Measurement',
  };

  const CONTENT_TYPE_ICONS: Record<string, typeof Type> = {
    text: Type, emoji: Smile, gif: Film, image: ImageIcon, link: Link2, iiif: Waypoints,
  };

  let showForm = $state(false);
  let creating = $state(false);
  let createError = $state<string | null>(null);

  // Form fields — content type selection
  let formType = $state<ContentType>('text');

  // Text
  let formText = $state('');

  // Emoji
  let formEmoji = $state('');
  let formEmojiLabel = $state('');

  // GIF (URL + optional alt text)
  let formGifUrl = $state('');
  let formAltText = $state('');

  // Image — supports both direct URL and file upload
  let formImageUrl = $state('');
  let formCaption = $state('');

  /**
   * Image-upload-specific state.
   * A file can be selected in addition to (or instead of) a manual URL.
   * When both are provided the uploaded file takes precedence.
   */
  let selectedImageFile = $state<File | null>(null);
  /** Object URL for the local preview — revoked on reset or new selection. */
  let imagePreviewUrl = $state<string | null>(null);
  /**
   * True when EXIF GPS data was found in the selected file.
   * Shown as a small badge next to the coordinate inputs.
   */
  let gpsExtracted = $state(false);
  /** True while the selected image is being uploaded to /api/annotation-upload. */
  let uploading = $state(false);
  /** True while EXIF GPS data is being parsed from a selected image file. */
  let parsingExif = $state(false);

  // Link
  let formLinkUrl = $state('');
  let formLinkTitle = $state('');
  let formLinkDesc = $state('');

  // IIIF
  let formManifestUrl = $state('');
  let formIiifLabel = $state('');

  // Anchor — defaults to current map center as a useful starting point;
  // user can adjust the numeric inputs to place the pin exactly.
  // Initialized eagerly (not via $effect) to avoid tracking mapStore.center
  // as a reactive dependency — that would cycle during scroll zoom events.
  const [_initLng, _initLat] = mapStore.center;
  let formLng = $state(Math.round(_initLng * 1_000_000) / 1_000_000);
  let formLat = $state(Math.round(_initLat * 1_000_000) / 1_000_000);

  // Anchor type selector
  let formAnchorType = $state<'point' | 'region' | 'viewport' | 'feature'>('point');

  const canSubmit = $derived(!(
    creating || uploading || parsingExif
    || (formType === 'text' && !formText.trim())
    || (formType === 'emoji' && !formEmoji.trim())
    || (formType === 'gif' && !formGifUrl.trim())
    || (formType === 'image' && !formImageUrl && !selectedImageFile)
    || (formType === 'link' && !formLinkUrl.trim())
    || (formType === 'iiif' && !formManifestUrl.trim())
    || (formAnchorType === 'region' && !regionGeometry)
    || (formAnchorType === 'feature' && !pickedFeature)
  ));

  // Request feature pick mode when anchor type is 'feature' but no feature selected yet.
  $effect(() => {
    effectEnter('AP:requestFeaturePick', { formAnchorType, hasPicked: !!pickedFeature });
    if (formAnchorType === 'feature' && !pickedFeature) {
      untrack(() => onrequestfeaturepick?.());
    }
    effectExit('AP:requestFeaturePick');
  });

  // Auto-open form when a picked feature arrives
  $effect(() => {
    effectEnter('AP:autoOpenPicked', { hasPicked: !!pickedFeature });
    if (pickedFeature && !untrack(() => showForm)) {
      formAnchorType = 'feature';
      showForm = true;
    }
    effectExit('AP:autoOpenPicked');
  });

  // Auto-open form when a region geometry arrives
  $effect(() => {
    effectEnter('AP:autoOpenRegion', { hasRegion: !!regionGeometry });
    if (regionGeometry && !untrack(() => showForm)) {
      formAnchorType = 'region';
      showForm = true;
    }
    effectExit('AP:autoOpenRegion');
  });

  // Track pending measurement data for the create flow
  let pendingMeasurementData = $state<typeof pendingMeasurement>(null);

  $effect(() => {
    effectEnter('AP:pendingMeasurement', { hasPending: !!pendingMeasurement });
    if (pendingMeasurement) {
      pendingMeasurementData = pendingMeasurement;
      formType = 'measurement';
      formAnchorType = 'viewport';
      showForm = true;
    }
    effectExit('AP:pendingMeasurement');
  });

  // formLng/formLat are initialized eagerly from mapStore.center at declaration
  // (see above). No $effect.pre needed — avoids reactive dependency on
  // mapStore.center which cycles during scroll zoom tile loading.

  // ── Image file handling ────────────────────────────────────────────────────

  /**
   * Handle image file selection:
   *   1. Create an object URL for an instant local preview (no upload yet).
   *   2. Parse EXIF GPS with `exifr` — if coordinates are found, auto-fill the
   *      anchor inputs and show a "GPS from EXIF" badge.
   *
   * The actual upload happens in `handleCreate` (just before the tRPC mutation)
   * so the server round-trip only happens when the user clicks Save.
   */
  async function handleImageFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    // Revoke the previous object URL to prevent memory leaks
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      imagePreviewUrl = null;
    }

    gpsExtracted = false;
    selectedImageFile = file;

    if (!file) return;

    // Instant local preview — no server round-trip
    imagePreviewUrl = URL.createObjectURL(file);

    // EXIF GPS extraction — exifr.gps() handles both DMS and decimal-degree formats
    // and normalises to { latitude: number, longitude: number } in WGS84.
    parsingExif = true;
    try {
      const gps = await exifr.gps(file);
      if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
        formLat = Math.round(gps.latitude  * 1_000_000) / 1_000_000;
        formLng = Math.round(gps.longitude * 1_000_000) / 1_000_000;
        gpsExtracted = true;
      }
    } catch {
      // EXIF parsing failure is non-fatal — user can set coordinates manually
    } finally {
      parsingExif = false;
    }
  }

  /**
   * Upload the selected image file to /api/annotation-upload.
   * Returns the absolute URL of the stored image.
   */
  async function uploadImageFile(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);

    const res = await fetch('/api/annotation-upload', { method: 'POST', body: fd });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `Upload failed (HTTP ${res.status})`);
    }

    const data = await res.json() as { url?: string };
    if (typeof data.url !== 'string') throw new Error('Upload returned no URL');
    return data.url;
  }

  /** Build the typed AnnotationContent from current form state. */
  function buildContent(): AC {
    switch (formType) {
      case 'text':
        return { type: 'text', text: formText };
      case 'emoji':
        return {
          type: 'emoji',
          emoji: formEmoji,
          ...(formEmojiLabel.trim() ? { label: formEmojiLabel.trim() } : {}),
        };
      case 'gif':
        return {
          type: 'gif',
          url: formGifUrl,
          ...(formAltText.trim() ? { altText: formAltText.trim() } : {}),
        };
      case 'image':
        // URL is set to formImageUrl now; if a file was selected, uploadImageFile()
        // has already replaced formImageUrl with the uploaded URL before we get here.
        return {
          type: 'image',
          url: formImageUrl,
          ...(formCaption.trim() ? { caption: formCaption.trim() } : {}),
        };
      case 'link':
        return {
          type: 'link',
          url: formLinkUrl,
          ...(formLinkTitle.trim() ? { title: formLinkTitle.trim() } : {}),
          ...(formLinkDesc.trim() ? { description: formLinkDesc.trim() } : {}),
        };
      case 'iiif':
        return {
          type: 'iiif',
          manifestUrl: formManifestUrl,
          ...(formIiifLabel.trim() ? { label: formIiifLabel.trim() } : {}),
        };
      case 'measurement':
        // Measurement content is pre-filled by the measurement-to-annotation flow;
        // buildContent() should never be called with formType='measurement' directly.
        return { type: 'measurement', measurementType: 'distance', value: 0, unit: 'm', displayValue: '0 m' };
    }
  }

  function resetForm() {
    formType = 'text';
    formText = '';
    formEmoji = '';
    formEmojiLabel = '';
    formGifUrl = '';
    formAltText = '';
    formImageUrl = '';
    formCaption = '';
    formLinkUrl = '';
    formLinkTitle = '';
    formLinkDesc = '';
    formManifestUrl = '';
    formIiifLabel = '';
    // Anchor state
    formAnchorType = 'point';
    formLng = 0;
    formLat = 0;
    // Image upload state
    if (imagePreviewUrl) { URL.revokeObjectURL(imagePreviewUrl); imagePreviewUrl = null; }
    selectedImageFile = null;
    gpsExtracted = false;
    parsingExif = false;
    pendingMeasurementData = null;
  }

  // ── Annotation mutations (TanStack Query) ──────────────────────────────────

  const createAnnotationMutation = createMutation(() => ({
    mutationFn: (input: { mapId: string; anchor: Anchor; content: { kind: 'single'; body: AC } }) =>
      trpc.annotations.create.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.annotations.list({ mapId }) });
    },
  }));

  const deleteAnnotationMutation = createMutation(() => ({
    mutationFn: (input: { id: string }) => trpc.annotations.delete.mutate(input),
    onMutate: async ({ id }: { id: string }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.annotations.list({ mapId }) });
      const previous = queryClient.getQueryData<AnnotationObject[]>(queryKeys.annotations.list({ mapId }));
      queryClient.setQueryData<AnnotationObject[]>(
        queryKeys.annotations.list({ mapId }),
        (old) => old?.filter((a) => a.id !== id) ?? []
      );
      return { previous } as { previous?: AnnotationObject[] };
    },
    onError: (_err: unknown, _vars: { id: string }, context: { previous?: AnnotationObject[] } | undefined) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.annotations.list({ mapId }), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.annotations.list({ mapId }) });
      // Also invalidate any open thread — the deleted item may be a reply
      queryClient.invalidateQueries({ queryKey: ['annotations', 'getThread'] });
    },
  }));

  const updateAnnotationMutation = createMutation(() => ({
    mutationFn: ((input: { id: string; content?: { kind: 'single'; body: AC }; anchor?: Anchor; version?: number }) =>
      trpc.annotations.update.mutate(input)) as any,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.annotations.list({ mapId }) });
    },
  }));

  const replyAnnotationMutation = createMutation(() => ({
    mutationFn: ((input: { mapId: string; parentId: string; anchor: Anchor; content: { kind: 'single'; body: AC } }) =>
      trpc.annotations.create.mutate(input)) as any,
    onSuccess: (_data: unknown, variables: { parentId: string }) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.annotations.list({ mapId }) });
      queryClient.invalidateQueries({ queryKey: queryKeys.annotations.thread({ annotationId: variables.parentId }) });
    },
  }));

  const convertToPointMutation = createMutation(() => ({
    mutationFn: (input: { mapId: string; annotationId: string; coordinates: [number, number] }) =>
      trpc.annotations.convertToPoint.mutate(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.annotations.list({ mapId }) });
    },
    onError: (_err: unknown) => {
      toastStore.error('Failed to convert annotation to point.');
    },
  }));

  async function handleCreate(e: Event) {
    e.preventDefault();
    creating = true;
    createError = null;

    try {
      // Image upload (if a file was selected) — happens before buildContent()
      // so the URL is present when the content object is assembled.
      if (formType === 'image' && selectedImageFile) {
        uploading = true;
        formImageUrl = '';
        try {
          formImageUrl = await uploadImageFile(selectedImageFile);
        } catch (uploadErr) {
          uploading = false;
          const fileName = selectedImageFile.name;
          createError = `Failed to upload ${fileName}: ${(uploadErr as { message?: string })?.message ?? 'unknown error'}`;
          creating = false;
          return;
        } finally {
          uploading = false;
        }
      }

      // Measurement annotations use pre-filled content + anchor from the measure panel
      const pm = formType === 'measurement' ? pendingMeasurementData : null;
      const content = pm != null ? pm.content : buildContent();

      // TYPE_DEBT: regionGeometry coordinates come from Terra Draw as number[][][] but
      // the Anchor schema expects typed tuples — the runtime values are always valid pairs.
      const anchor: Anchor = pm != null
        ? pm.anchor
        : formAnchorType === 'viewport'
          ? { type: 'viewport' }
          : formAnchorType === 'region' && regionGeometry
            ? { type: 'region', geometry: regionGeometry as { type: 'Polygon'; coordinates: ([number, number] | [number, number, number])[][] } }
            : formAnchorType === 'feature' && pickedFeature
              ? { type: 'feature', featureId: pickedFeature.featureId, layerId: pickedFeature.layerId }
              : { type: 'point', geometry: { type: 'Point', coordinates: [formLng, formLat] } };

      await createAnnotationMutation.mutateAsync({
        mapId,
        anchor,
        content: { kind: 'single', body: content },
      });

      showForm = false;
      resetForm();
      onannotationsaved('created');
      toastStore.success('Annotation saved.');
      // Scroll list to top so the newly created annotation is visible when the query refetches
      tick().then(() => { listContainerEl?.scrollTo({ top: 0, behavior: 'smooth' }); });
    } catch (err: unknown) {
      createError = (err as { message?: string })?.message ?? 'Failed to create annotation.';
    } finally {
      creating = false;
      uploading = false;
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this annotation? This cannot be undone.')) return;
    try {
      await deleteAnnotationMutation.mutateAsync({ id });
      onannotationsaved('deleted');
      toastStore.success('Annotation deleted.');
    } catch (err: unknown) {
      toastStore.error((err as { message?: string })?.message ?? 'Failed to delete annotation.');
    }
  }

  /** Fetch the IIIF manifest NavPlace and persist it to the annotation. */
  async function handleFetchNavPlace(annotation: AnnotationObject) {
    if (annotation.content.kind !== 'single' || annotation.content.body.type !== 'iiif') return;
    try {
      const navPlace = await trpc.annotations.fetchIiifNavPlace.query({
        manifestUrl: annotation.content.body.manifestUrl,
      });
      if (navPlace) {
        await updateAnnotationMutation.mutateAsync({
          id: annotation.id,
          content: { kind: 'single', body: { ...annotation.content.body, navPlace } },
          version: annotation.version,
        });
        onannotationsaved();
      }
    } catch {
      // Best-effort — don't block UI on NavPlace fetch failures
    }
  }

  /** Convert an orphaned feature-anchored annotation to a point anchor using map center. */
  async function handleConvertToPoint(annotation: AnnotationObject) {
    if (annotation.anchor.type !== 'feature' || !annotation.anchor.featureDeleted) return;
    try {
      const [lng, lat] = mapStore.center;
      await updateAnnotationMutation.mutateAsync({
        id: annotation.id,
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [lng, lat] } },
        version: annotation.version,
      });
      onannotationsaved();
    } catch (err: unknown) {
      toastStore.error((err as { message?: string })?.message ?? 'Failed to convert annotation.');
    }
  }

  // ── Scroll-to-feature support ───────────────────────────────────────────────
  $effect(() => {
    effectEnter('AP:scrollToFeature', { scrollToFeatureId });
    if (!scrollToFeatureId) { effectExit('AP:scrollToFeature'); return; }
    const match = annotationList.find(
      (a) => a.anchor.type === 'feature' && (a.anchor as { featureId: string }).featureId === scrollToFeatureId
    );
    if (match) {
      expandedAnnotationId = match.id;
      tick().then(() => {
        document.getElementById(`annotation-${match.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    }
    effectExit('AP:scrollToFeature');
  });

  // ── Thread / reply state ────────────────────────────────────────────────────

  let listContainerEl = $state<HTMLDivElement | undefined>(undefined);
  let expandedAnnotationId = $state<string | null>(null);
  let replyingTo = $state<string | null>(null);
  let replyText = $state('');

  async function handleReply(parentId: string) {
    if (!replyText.trim()) return;
    try {
      const parentAnnotation = annotationList.find(a => a.id === parentId);
      if (!parentAnnotation) return;
      await replyAnnotationMutation.mutateAsync({
        mapId,
        parentId,
        anchor: parentAnnotation.anchor,
        content: { kind: 'single', body: { type: 'text', text: replyText.trim() } },
      });
      replyText = '';
      replyingTo = null;
      expandedAnnotationId = parentId; // keep thread open
      onannotationsaved('created');
      toastStore.success('Reply posted.');
    } catch (err: unknown) {
      toastStore.error((err as { message?: string })?.message ?? 'Failed to post reply.');
    }
  }
</script>

<div class="flex flex-col h-full {embedded !== true ? 'bg-surface-container border-l border-white/5' : ''}">
  {#if embedded !== true}
  <!-- Header -->
  <div class="px-3 py-2 border-b border-white/5 shrink-0 flex items-center justify-between">
    <span class="text-xs font-semibold text-on-surface-variant uppercase tracking-wide">Annotations</span>
    <Button
      variant="ghost"
      size="sm"
      onclick={() => { if (showForm) resetForm(); showForm = !showForm; createError = null; }}
    >
      {showForm ? 'Cancel' : '+ Add'}
    </Button>
  </div>
  {:else}
  <!-- Embedded: just the add button, right-aligned -->
  <div class="px-3 py-1 shrink-0 flex justify-end">
    <Button
      variant="ghost"
      size="sm"
      onclick={() => { if (showForm) resetForm(); showForm = !showForm; createError = null; }}
    >
      {showForm ? 'Cancel' : '+ Add'}
    </Button>
  </div>
  {/if}

  <!-- Create form (collapsible) -->
  {#if showForm}
    <form
      onsubmit={handleCreate}
      class="border-b border-white/5 p-3 flex flex-col gap-2 shrink-0"
    >
      <!-- Content type grid -->
      <div class="grid grid-cols-3 gap-1.5">
        {#each CONTENT_TYPES as t (t)}
          {@const Icon = CONTENT_TYPE_ICONS[t]}
          <button
            type="button"
            onclick={() => { formType = t; }}
            class="flex flex-col items-center justify-center p-2.5 rounded-lg transition-all
                   {formType === t
                     ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                     : 'bg-surface-container-low text-on-surface-variant hover:bg-surface-high'}"
          >
            {#if Icon}
              <Icon size={18} strokeWidth={formType === t ? 2.5 : 1.5} />
            {/if}
            <span class="text-[9px] font-bold uppercase tracking-wider mt-1">{CONTENT_TYPE_LABELS[t]}</span>
          </button>
        {/each}
      </div>

      <!-- Per-type fields -->
      {#if formType === 'text'}
        <div class="flex flex-col gap-1">
          <label class="text-xs text-on-surface-variant" for="ann-text">Note</label>
          <textarea
            id="ann-text"
            bind:value={formText}
            rows={3}
            placeholder="Write your note…"
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
          ></textarea>
        </div>

      {:else if formType === 'emoji'}
        <div class="flex gap-2">
          <div class="flex flex-col gap-1 w-20">
            <label class="text-xs text-on-surface-variant" for="ann-emoji">Emoji</label>
            <input
              id="ann-emoji"
              type="text"
              bind:value={formEmoji}
              placeholder="🌊"
              maxlength={10}
              class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
          <div class="flex flex-col gap-1 flex-1">
            <label class="text-xs text-on-surface-variant" for="ann-emoji-label">
              Label <span class="text-on-surface-variant/70">(optional)</span>
            </label>
            <input
              id="ann-emoji-label"
              type="text"
              bind:value={formEmojiLabel}
              placeholder="Short label"
              class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

      {:else if formType === 'gif'}
        <div class="flex flex-col gap-1">
          <label class="text-xs text-on-surface-variant" for="ann-gif-url">GIF URL</label>
          <input
            id="ann-gif-url"
            type="url"
            bind:value={formGifUrl}
            placeholder="https://media.tenor.com/…"
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-on-surface-variant" for="ann-alt">
            Alt text <span class="text-on-surface-variant/70">(optional)</span>
          </label>
          <input
            id="ann-alt"
            type="text"
            bind:value={formAltText}
            placeholder="Accessible description"
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

      {:else if formType === 'image'}
        <!--
          Image type: supports two input paths.
          1. File upload — pick a local image; EXIF GPS auto-fills the anchor.
          2. URL — paste a publicly accessible image URL directly.
          The file takes precedence when both are provided.
        -->
        <div class="flex flex-col gap-1">
          <label class="text-xs text-on-surface-variant" for="ann-image-file">
            Upload image
            <span class="text-on-surface-variant/70 font-normal">(JPEG · PNG · WebP · GIF · max 10 MB)</span>
          </label>
          <input
            id="ann-image-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onchange={handleImageFileSelect}
            class="w-full text-xs text-on-surface file:mr-2 file:rounded file:border-0 file:bg-surface-container-low file:px-2 file:py-1 file:text-xs file:text-on-surface hover:file:bg-surface-high"
          />
        </div>

        <!-- Local preview — shown immediately after file selection, before upload -->
        {#if imagePreviewUrl}
          <div class="relative">
            <img
              src={imagePreviewUrl}
              alt="Selected file preview"
              class="rounded w-full object-contain bg-surface-lowest"
              style="max-height: 8rem"
            />
            {#if gpsExtracted}
              <!--
                GPS badge — informs the user that the anchor was auto-set from EXIF.
                Uses a green pill with a location-pin emoji so it reads at a glance
                without needing to compare the coordinate inputs.
              -->
              <span
                class="absolute top-1 right-1 rounded-full bg-green-600/90 px-2 py-0.5 text-[10px] font-semibold text-white"
                title="Latitude and longitude were extracted from the image's EXIF GPS data"
              >
                📍 GPS from EXIF
              </span>
            {/if}
          </div>
        {/if}

        <!-- Manual URL fallback (or primary when no file is chosen) -->
        <div class="flex flex-col gap-1">
          <label class="text-xs text-on-surface-variant" for="ann-image-url">
            {selectedImageFile ? 'Or paste URL instead' : 'Image URL'}
          </label>
          <input
            id="ann-image-url"
            type="url"
            bind:value={formImageUrl}
            placeholder="https://example.com/photo.jpg"
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs text-on-surface-variant" for="ann-caption">
            Caption <span class="text-on-surface-variant/70">(optional)</span>
          </label>
          <input
            id="ann-caption"
            type="text"
            bind:value={formCaption}
            placeholder="Caption"
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

      {:else if formType === 'link'}
        <div class="flex flex-col gap-1">
          <label class="text-xs text-on-surface-variant" for="ann-link-url">URL</label>
          <input
            id="ann-link-url"
            type="url"
            bind:value={formLinkUrl}
            placeholder="https://example.com"
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-on-surface-variant" for="ann-link-title">
            Title <span class="text-on-surface-variant/70">(optional)</span>
          </label>
          <input
            id="ann-link-title"
            type="text"
            bind:value={formLinkTitle}
            placeholder="Link title"
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-on-surface-variant" for="ann-link-desc">
            Description <span class="text-on-surface-variant/70">(optional)</span>
          </label>
          <input
            id="ann-link-desc"
            type="text"
            bind:value={formLinkDesc}
            placeholder="Brief description"
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>

      {:else if formType === 'iiif'}
        <div class="flex flex-col gap-1">
          <label class="text-xs text-on-surface-variant" for="ann-manifest">Manifest URL</label>
          <input
            id="ann-manifest"
            type="url"
            bind:value={formManifestUrl}
            placeholder="https://example.org/iiif/manifest.json"
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-on-surface-variant" for="ann-iiif-label">
            Label <span class="text-on-surface-variant/70">(optional)</span>
          </label>
          <input
            id="ann-iiif-label"
            type="text"
            bind:value={formIiifLabel}
            placeholder="Manuscript title"
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <p class="text-xs text-on-surface-variant/70 italic">NavPlace will be fetched automatically after saving.</p>
      {/if}

      <!-- Anchor type selector -->
      <div class="flex flex-col gap-1">
        <label class="text-xs text-on-surface-variant" for="ann-anchor-type">Anchor</label>
        <select
          id="ann-anchor-type"
          bind:value={formAnchorType}
          class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
        >
          <option value="point">Pin (Point)</option>
          <option value="region">Region (Polygon)</option>
          <option value="viewport">Map-level (No pin)</option>
          <option value="feature">Feature</option>
        </select>
      </div>

      <!-- Region drawing -->
      {#if formAnchorType === 'region'}
        <div class="flex flex-col gap-1">
          {#if regionGeometry}
            <p class="text-xs text-green-400 font-medium">Region drawn ({(regionGeometry?.coordinates[0]?.length ?? 1) - 1} vertices)</p>
            <button
              type="button"
              onclick={() => onrequestregion?.()}
              class="text-xs text-primary hover:text-primary/80 underline text-left"
            >
              Redraw region
            </button>
          {:else}
            <button
              type="button"
              onclick={() => onrequestregion?.()}
              class="w-full rounded bg-primary-container hover:bg-primary px-2 py-1.5 text-xs text-on-primary-container font-medium transition-colors"
            >
              Draw region on map
            </button>
            <p class="text-xs text-on-surface-variant/70 italic">Click the map to draw a polygon boundary.</p>
          {/if}
        </div>
      {/if}

      <!-- Feature anchor -->
      {#if formAnchorType === 'feature'}
        {#if pickedFeature}
          <div class="text-xs text-on-surface bg-surface-container-low rounded px-2 py-1 mt-1">
            Attached to feature <span class="font-mono text-amber-400">{pickedFeature.featureId.slice(0, 8)}…</span>
          </div>
        {:else}
          <p class="text-xs text-on-surface-variant italic mt-1">Click a feature on the map to attach this annotation.</p>
        {/if}
      {/if}

      <!-- Anchor coordinates -->
      {#if formAnchorType === 'point'}
      <div class="flex gap-2 items-end">
        <div class="flex flex-col gap-1 flex-1">
          <label class="text-xs text-on-surface-variant flex items-center gap-1" for="ann-lng">
            Longitude
            {#if gpsExtracted && formType === 'image'}
              <span class="text-[10px] text-green-400 font-medium">EXIF</span>
            {:else}
              <span class="text-[10px] text-on-surface-variant/50 ml-1">(from map center)</span>
            {/if}
          </label>
          <input
            id="ann-lng"
            type="number"
            min="-180"
            max="180"
            step="0.000001"
            bind:value={formLng}
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div class="flex flex-col gap-1 flex-1">
          <label class="text-xs text-on-surface-variant flex items-center gap-1" for="ann-lat">
            Latitude
            {#if gpsExtracted && formType === 'image'}
              <span class="text-[10px] text-green-400 font-medium">EXIF</span>
            {:else}
              <span class="text-[10px] text-on-surface-variant/50 ml-1">(from map center)</span>
            {/if}
          </label>
          <input
            id="ann-lat"
            type="number"
            min="-90"
            max="90"
            step="0.000001"
            bind:value={formLat}
            class="w-full rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>
      {/if}

      {#if createError}
        <p class="text-xs text-red-400">{createError}</p>
      {/if}

      <Button
        type="submit"
        size="sm"
        loading={creating || uploading}
        disabled={!canSubmit}
      >
        {#if uploading}Uploading…{:else if parsingExif}Reading image data…{:else}Save annotation{/if}
      </Button>
      {#if !canSubmit}
        <p class="text-xs text-on-surface-variant/70 mt-1">
          {#if parsingExif}
            Reading location data from image — please wait.
          {:else if uploading}
            Uploading image — please wait.
          {:else if creating}
            Saving — please wait.
          {:else if formAnchorType === 'region' && !regionGeometry}
            Draw a region on the map to anchor this annotation.
          {:else if formAnchorType === 'feature' && !pickedFeature}
            Select a feature on the map to attach this annotation.
          {:else if formType === 'text' && !formText.trim()}
            Write some text to save this annotation.
          {:else if formType === 'emoji' && !formEmoji.trim()}
            Enter an emoji to save this annotation.
          {:else if formType === 'gif' && !formGifUrl.trim()}
            Paste a GIF URL to save this annotation.
          {:else if formType === 'image' && !formImageUrl && !selectedImageFile}
            Upload an image or paste a URL to save this annotation.
          {:else if formType === 'link' && !formLinkUrl.trim()}
            Paste a link URL to save this annotation.
          {:else if formType === 'iiif' && !formManifestUrl.trim()}
            Paste an IIIF manifest URL to save this annotation.
          {:else}
            Add content to save this annotation.
          {/if}
        </p>
      {/if}
    </form>
  {/if}

  <!-- Annotation list -->
  <div class="flex-1 overflow-y-auto" bind:this={listContainerEl}>
    {#if listLoading}
      <p class="text-xs text-on-surface-variant/70 text-center py-6">Loading…</p>
    {:else if listError}
      <p class="text-xs text-red-400 px-3 py-4">{listError}</p>
    {:else if annotationList.length === 0 && comments.length === 0}
      <div class="flex flex-col items-center justify-center py-12 px-4 text-center">
        <svg class="h-6 w-6 text-on-surface-variant/70 mb-2" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M8 1a6 6 0 100 12A6 6 0 008 1zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3a1 1 0 011 1v2h2a1 1 0 010 2H9v2a1 1 0 01-2 0v-2H5a1 1 0 010-2h2V6a1 1 0 011-1z"/>
        </svg>
        <p class="text-sm text-on-surface-variant">No annotations yet. Click the map to add a note, or pick a feature to annotate it.</p>
      </div>
    {:else}
      {#each annotationList as annotation (annotation.id)}
        <div id="annotation-{annotation.id}" class="px-3 py-3 border-b border-white/5 space-y-2">
          <AnnotationContent
            content={annotation.content}
            authorName={annotation.authorName}
            createdAt={annotation.createdAt}
            featureDeleted={annotation.anchor.type === 'feature' && annotation.anchor.featureDeleted === true}
            onconverttopoint={annotation.anchor.type === 'feature' && annotation.anchor.featureDeleted === true
              ? () => {
                  const coords: [number, number] =
                    annotation.anchor.type === 'feature' && 'geometry' in annotation.anchor && annotation.anchor.geometry
                      ? (annotation.anchor.geometry as { type: string; coordinates: [number, number] }).coordinates
                      : [0, 0];
                  convertToPointMutation.mutate({ mapId, annotationId: annotation.id, coordinates: coords });
                }
              : undefined}
          />

          {#if annotation.anchor.type === 'viewport'}
            <span class="text-[10px] bg-amber-100/10 text-amber-400 px-1.5 py-0.5 rounded">Map-level</span>
          {:else if annotation.anchor.type === 'region'}
            <span class="text-[10px] bg-tertiary/10 text-tertiary px-1.5 py-0.5 rounded">Region</span>
          {/if}

          <!-- Thread controls -->
          <div class="flex gap-2 text-xs">
            <button
              onclick={() => { expandedAnnotationId = expandedAnnotationId === annotation.id ? null : annotation.id; }}
              class="text-on-surface-variant hover:text-on-surface"
            >
              {expandedAnnotationId === annotation.id ? 'Collapse' : 'Replies'}
            </button>
            {#if annotation.authorId === userId || userId}
              <button
                onclick={() => { replyingTo = replyingTo === annotation.id ? null : annotation.id; replyText = ''; }}
                class="text-primary hover:text-primary/80"
              >
                Reply
              </button>
            {/if}
          </div>

          <!-- Thread replies -->
          {#if expandedAnnotationId === annotation.id}
            <AnnotationThread
              annotationId={annotation.id}
              {userId}
              ondelete={handleDelete}
            />
          {/if}

          <!-- Reply form -->
          {#if replyingTo === annotation.id}
            <div class="ml-4 mt-1 flex gap-1">
              <textarea
                bind:value={replyText}
                placeholder="Write a reply..."
                rows={2}
                class="flex-1 rounded bg-surface-container-low border border-white/5 px-2 py-1 text-xs text-on-surface placeholder-on-surface-variant/50 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
              ></textarea>
              <Button
                size="sm"
                disabled={!replyText.trim()}
                onclick={() => handleReply(annotation.id)}
              >
                Send
              </Button>
            </div>
          {/if}

          <!-- Per-annotation actions -->
          <div class="flex gap-2">
            {#if annotation.anchor.type === 'feature' && annotation.anchor.featureDeleted === true}
              <button
                onclick={() => handleConvertToPoint(annotation)}
                class="text-xs text-amber-400 hover:text-amber-300 underline"
              >
                📍 Convert to map pin
              </button>
            {/if}
            {#if annotation.content.kind === 'single' && annotation.content.body.type === 'iiif' && !annotation.content.body.navPlace && annotation.authorId === userId}
              <button
                onclick={() => handleFetchNavPlace(annotation)}
                class="text-xs text-amber-400 hover:text-amber-300 underline"
              >
                Fetch NavPlace
              </button>
            {/if}
            {#if annotation.authorId === userId}
              <button
                onclick={() => handleDelete(annotation.id)}
                class="text-xs text-red-400 hover:text-red-300 ml-auto"
              >
                Delete
              </button>
            {/if}
          </div>
        </div>
      {/each}
    {/if}

    <!-- Comments sub-section -->
    <div class="border-t border-white/5 mt-2">
      <div class="px-3 py-2 flex items-center gap-2">
        <span class="text-xs font-semibold text-on-surface-variant uppercase tracking-wide flex-1">Map Comments<span class="text-[10px] text-on-surface-variant/70 font-normal normal-case tracking-normal ml-2">Notes visible to all collaborators</span></span>
        {#if comments.length > 0}
          <span class="text-xs text-on-surface-variant/70">{comments.length}</span>
        {/if}
      </div>

      {#if comments.length === 0}
        <p class="text-xs text-on-surface-variant text-center py-3 px-4">No comments yet.</p>
      {:else}
        <ul class="divide-y divide-white/5">
          {#each comments as comment (comment.id)}
            <li class="px-3 py-2 {comment.resolved ? 'opacity-50' : ''}">
              <div class="flex items-center gap-1 mb-1">
                <span class="text-xs font-medium text-on-surface truncate flex-1">{comment.authorName}</span>
                {#if comment.resolved}
                  <span class="text-xs text-green-500 shrink-0">resolved</span>
                {/if}
              </div>
              <p class="text-xs text-on-surface leading-relaxed whitespace-pre-wrap break-words">{comment.body}</p>
              {#if userId}
                <div class="flex gap-2 mt-1">
                  <button
                    class="text-xs text-on-surface-variant/70 hover:text-on-surface transition-colors"
                    onclick={() => handleCommentResolve(comment.id)}
                  >
                    {comment.resolved ? 'Unresolve' : 'Resolve'}
                  </button>
                  {#if comment.userId === userId}
                    <button
                      class="text-xs text-on-surface-variant/70 hover:text-red-400 transition-colors"
                      onclick={() => handleCommentDelete(comment.id)}
                    >
                      Delete
                    </button>
                  {/if}
                </div>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}

      <!-- Quick comment form -->
      <form
        onsubmit={(e) => { e.preventDefault(); handleCommentSubmit(); }}
        class="p-3 flex gap-2"
      >
        <input
          bind:value={commentBody}
          placeholder="Leave a comment..."
          class="flex-1 rounded bg-surface-container-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="submit"
          disabled={!commentBody.trim() || submittingComment}
          class="text-xs text-primary hover:text-primary/80 disabled:text-on-surface-variant/70 disabled:cursor-not-allowed transition-colors px-2"
        >
          Post
        </button>
      </form>
    </div>
  </div>
</div>
