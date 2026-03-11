<script lang="ts">
  import exifr from 'exifr';
  import { trpc } from '$lib/utils/trpc.js';
  import Button from '$lib/components/ui/Button.svelte';
  import AnnotationContent from './AnnotationContent.svelte';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import type { AnnotationObject, AnnotationContent as AC, Anchor } from '@felt-like-it/shared-types';

  interface Props {
    mapId: string;
    /** Authenticated user id — used to gate edit / delete buttons. */
    userId?: string;
    /** Called after any mutation (create / delete) so the parent can refresh the map pins. */
    onannotationchange: () => void;
    /** Called when the user wants to draw a region polygon on the map. */
    onrequestregion?: () => void;
    /** Polygon geometry drawn on the map, passed back by the parent. */
    regionGeometry?: { type: 'Polygon'; coordinates: number[][][] } | undefined;
  }

  let { mapId, userId, onannotationchange, onrequestregion, regionGeometry = undefined }: Props = $props();

  // ── Annotation list ────────────────────────────────────────────────────────

  let annotationList = $state<AnnotationObject[]>([]);
  let listLoading = $state(false);
  let listError = $state<string | null>(null);

  async function loadAnnotations() {
    listLoading = true;
    listError = null;
    try {
      annotationList = await trpc.annotations.list.query({ mapId });
    } catch (err: unknown) {
      listError = (err as { message?: string })?.message ?? 'Failed to load annotations.';
    } finally {
      listLoading = false;
    }
  }

  $effect(() => { loadAnnotations(); });

  // Cleanup blob URL on component unmount to prevent memory leaks
  $effect(() => {
    return () => {
      if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    };
  });

  // ── Create form ────────────────────────────────────────────────────────────

  type ContentType = AC['type'];

  const CONTENT_TYPES: ContentType[] = ['text', 'emoji', 'gif', 'image', 'link', 'iiif'];

  const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
    text:  'Text note',
    emoji: 'Emoji pin',
    gif:   'GIF',
    image: 'Image',
    link:  'Link card',
    iiif:  'IIIF Manifest',
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

  // Link
  let formLinkUrl = $state('');
  let formLinkTitle = $state('');
  let formLinkDesc = $state('');

  // IIIF
  let formManifestUrl = $state('');
  let formIiifLabel = $state('');

  // Anchor — defaults to current map center as a useful starting point;
  // user can adjust the numeric inputs to place the pin exactly.
  let formLng = $state(0);
  let formLat = $state(0);

  // Anchor type selector
  let formAnchorType = $state<'point' | 'region' | 'viewport'>('point');

  $effect.pre(() => {
    if (formLng === 0 && formLat === 0) {
      const [lng, lat] = mapStore.center;
      formLng = Math.round(lng * 1_000_000) / 1_000_000;
      formLat = Math.round(lat * 1_000_000) / 1_000_000;
    }
  });

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
    try {
      const gps = await exifr.gps(file);
      if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
        formLat = Math.round(gps.latitude  * 1_000_000) / 1_000_000;
        formLng = Math.round(gps.longitude * 1_000_000) / 1_000_000;
        gpsExtracted = true;
      }
    } catch {
      // EXIF parsing failure is non-fatal — user can set coordinates manually
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
    }
  }

  function resetForm() {
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
    // Image upload state
    if (imagePreviewUrl) { URL.revokeObjectURL(imagePreviewUrl); imagePreviewUrl = null; }
    selectedImageFile = null;
    gpsExtracted = false;
  }

  async function handleCreate(e: Event) {
    e.preventDefault();
    creating = true;
    createError = null;

    try {
      // Image upload (if a file was selected) — happens before buildContent()
      // so the URL is present when the content object is assembled.
      if (formType === 'image' && selectedImageFile) {
        uploading = true;
        try {
          formImageUrl = await uploadImageFile(selectedImageFile);
        } finally {
          uploading = false;
        }
      }

      const content = buildContent();

      // TYPE_DEBT: regionGeometry coordinates come from Terra Draw as number[][][] but
      // the Anchor schema expects typed tuples — the runtime values are always valid pairs.
      const anchor: Anchor = formAnchorType === 'viewport'
        ? { type: 'viewport' }
        : formAnchorType === 'region' && regionGeometry
          ? { type: 'region', geometry: regionGeometry as { type: 'Polygon'; coordinates: ([number, number] | [number, number, number])[][] } }
          : { type: 'point', geometry: { type: 'Point', coordinates: [formLng, formLat] } };

      await trpc.annotations.create.mutate({
        mapId,
        anchor,
        content: { kind: 'single', body: content },
      });

      showForm = false;
      resetForm();
      await loadAnnotations();
      onannotationchange();
    } catch (err: unknown) {
      createError = (err as { message?: string })?.message ?? 'Failed to create annotation.';
    } finally {
      creating = false;
      uploading = false;
    }
  }

  async function handleDelete(id: string) {
    try {
      await trpc.annotations.delete.mutate({ id });
      await loadAnnotations();
      onannotationchange();
    } catch (err: unknown) {
      listError = (err as { message?: string })?.message ?? 'Failed to delete annotation.';
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
        await trpc.annotations.update.mutate({
          id: annotation.id,
          content: { kind: 'single', body: { ...annotation.content.body, navPlace } },
          version: annotation.version,
        });
        await loadAnnotations();
        onannotationchange();
      }
    } catch {
      // Best-effort — don't block UI on NavPlace fetch failures
    }
  }

  // ── Thread / reply state ────────────────────────────────────────────────────

  let expandedAnnotationId = $state<string | null>(null);
  let replyingTo = $state<string | null>(null);
  let replyText = $state('');

  async function handleReply(parentId: string) {
    if (!replyText.trim()) return;
    try {
      const parentAnnotation = annotationList.find(a => a.id === parentId);
      if (!parentAnnotation) return;
      await trpc.annotations.create.mutate({
        mapId,
        parentId,
        anchor: parentAnnotation.anchor,
        content: { kind: 'single', body: { type: 'text', text: replyText.trim() } },
      });
      replyText = '';
      replyingTo = null;
      expandedAnnotationId = parentId; // keep thread open
      await loadAnnotations();
      onannotationchange();
    } catch (err: unknown) {
      listError = (err as { message?: string })?.message ?? 'Failed to post reply.';
    }
  }
</script>

<div class="flex flex-col h-full bg-slate-800 border-l border-white/10">
  <!-- Header -->
  <div class="px-3 py-2 border-b border-white/10 shrink-0 flex items-center justify-between">
    <span class="text-xs font-semibold text-slate-400 uppercase tracking-wide">Annotations</span>
    <Button
      variant="ghost"
      size="sm"
      onclick={() => { showForm = !showForm; createError = null; }}
    >
      {showForm ? 'Cancel' : '+ Add'}
    </Button>
  </div>

  <!-- Create form (collapsible) -->
  {#if showForm}
    <form
      onsubmit={handleCreate}
      class="border-b border-white/10 p-3 flex flex-col gap-2 shrink-0"
    >
      <!-- Content type selector -->
      <div class="flex flex-col gap-1">
        <label class="text-xs text-slate-400" for="ann-type">Type</label>
        <select
          id="ann-type"
          bind:value={formType}
          class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {#each CONTENT_TYPES as t (t)}
            <option value={t}>{CONTENT_TYPE_LABELS[t]}</option>
          {/each}
        </select>
      </div>

      <!-- Per-type fields -->
      {#if formType === 'text'}
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-text">Note</label>
          <textarea
            id="ann-text"
            bind:value={formText}
            rows={3}
            placeholder="Write your note…"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none"
          ></textarea>
        </div>

      {:else if formType === 'emoji'}
        <div class="flex gap-2">
          <div class="flex flex-col gap-1 w-20">
            <label class="text-xs text-slate-400" for="ann-emoji">Emoji</label>
            <input
              id="ann-emoji"
              type="text"
              bind:value={formEmoji}
              placeholder="🌊"
              maxlength={10}
              class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div class="flex flex-col gap-1 flex-1">
            <label class="text-xs text-slate-400" for="ann-emoji-label">
              Label <span class="text-slate-500">(optional)</span>
            </label>
            <input
              id="ann-emoji-label"
              type="text"
              bind:value={formEmojiLabel}
              placeholder="Short label"
              class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

      {:else if formType === 'gif'}
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-gif-url">GIF URL</label>
          <input
            id="ann-gif-url"
            type="url"
            bind:value={formGifUrl}
            placeholder="https://media.tenor.com/…"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-alt">
            Alt text <span class="text-slate-500">(optional)</span>
          </label>
          <input
            id="ann-alt"
            type="text"
            bind:value={formAltText}
            placeholder="Accessible description"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
          <label class="text-xs text-slate-400" for="ann-image-file">
            Upload image
            <span class="text-slate-500 font-normal">(JPEG · PNG · WebP · GIF · max 10 MB)</span>
          </label>
          <input
            id="ann-image-file"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            onchange={handleImageFileSelect}
            class="w-full text-xs text-slate-300 file:mr-2 file:rounded file:border-0 file:bg-slate-600 file:px-2 file:py-1 file:text-xs file:text-slate-200 hover:file:bg-slate-500"
          />
        </div>

        <!-- Local preview — shown immediately after file selection, before upload -->
        {#if imagePreviewUrl}
          <div class="relative">
            <img
              src={imagePreviewUrl}
              alt="Selected file preview"
              class="rounded w-full object-contain bg-slate-900"
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
          <label class="text-xs text-slate-400" for="ann-image-url">
            {selectedImageFile ? 'Or paste URL instead' : 'Image URL'}
          </label>
          <input
            id="ann-image-url"
            type="url"
            bind:value={formImageUrl}
            placeholder="https://example.com/photo.jpg"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-caption">
            Caption <span class="text-slate-500">(optional)</span>
          </label>
          <input
            id="ann-caption"
            type="text"
            bind:value={formCaption}
            placeholder="Caption"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

      {:else if formType === 'link'}
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-link-url">URL</label>
          <input
            id="ann-link-url"
            type="url"
            bind:value={formLinkUrl}
            placeholder="https://example.com"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-link-title">
            Title <span class="text-slate-500">(optional)</span>
          </label>
          <input
            id="ann-link-title"
            type="text"
            bind:value={formLinkTitle}
            placeholder="Link title"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-link-desc">
            Description <span class="text-slate-500">(optional)</span>
          </label>
          <input
            id="ann-link-desc"
            type="text"
            bind:value={formLinkDesc}
            placeholder="Brief description"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

      {:else if formType === 'iiif'}
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-manifest">Manifest URL</label>
          <input
            id="ann-manifest"
            type="url"
            bind:value={formManifestUrl}
            placeholder="https://example.org/iiif/manifest.json"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-iiif-label">
            Label <span class="text-slate-500">(optional)</span>
          </label>
          <input
            id="ann-iiif-label"
            type="text"
            bind:value={formIiifLabel}
            placeholder="Manuscript title"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <p class="text-xs text-slate-500 italic">NavPlace will be fetched automatically after saving.</p>
      {/if}

      <!-- Anchor type selector -->
      <div class="flex flex-col gap-1">
        <label class="text-xs text-slate-400" for="ann-anchor-type">Anchor</label>
        <select
          id="ann-anchor-type"
          bind:value={formAnchorType}
          class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="point">Pin (Point)</option>
          <option value="region">Region (Polygon)</option>
          <option value="viewport">Map-level (No pin)</option>
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
              class="text-xs text-blue-400 hover:text-blue-300 underline text-left"
            >
              Redraw region
            </button>
          {:else}
            <button
              type="button"
              onclick={() => onrequestregion?.()}
              class="w-full rounded bg-blue-600 hover:bg-blue-500 px-2 py-1.5 text-xs text-white font-medium transition-colors"
            >
              Draw region on map
            </button>
            <p class="text-xs text-slate-500 italic">Click the map to draw a polygon boundary.</p>
          {/if}
        </div>
      {/if}

      <!-- Anchor coordinates -->
      {#if formAnchorType === 'point'}
      <div class="flex gap-2 items-end">
        <div class="flex flex-col gap-1 flex-1">
          <label class="text-xs text-slate-400 flex items-center gap-1" for="ann-lng">
            Lng
            {#if gpsExtracted && formType === 'image'}
              <span class="text-[10px] text-green-400 font-medium">EXIF</span>
            {/if}
          </label>
          <input
            id="ann-lng"
            type="number"
            min="-180"
            max="180"
            step="0.000001"
            bind:value={formLng}
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div class="flex flex-col gap-1 flex-1">
          <label class="text-xs text-slate-400 flex items-center gap-1" for="ann-lat">
            Lat
            {#if gpsExtracted && formType === 'image'}
              <span class="text-[10px] text-green-400 font-medium">EXIF</span>
            {/if}
          </label>
          <input
            id="ann-lat"
            type="number"
            min="-90"
            max="90"
            step="0.000001"
            bind:value={formLat}
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
        disabled={creating || uploading
          || (formType === 'text' && !formText.trim())
          || (formType === 'emoji' && !formEmoji.trim())
          || (formType === 'gif' && !formGifUrl.trim())
          || (formType === 'image' && !formImageUrl && !selectedImageFile)
          || (formType === 'link' && !formLinkUrl.trim())
          || (formType === 'iiif' && !formManifestUrl.trim())
          || (formAnchorType === 'region' && !regionGeometry)}
      >
        {#if uploading}Uploading…{:else}Save annotation{/if}
      </Button>
    </form>
  {/if}

  <!-- Annotation list -->
  <div class="flex-1 overflow-y-auto">
    {#if listLoading}
      <p class="text-xs text-slate-500 text-center py-6">Loading…</p>
    {:else if listError}
      <p class="text-xs text-red-400 px-3 py-4">{listError}</p>
    {:else if annotationList.length === 0}
      <p class="text-xs text-slate-500 text-center py-6">No annotations yet.</p>
    {:else}
      {#each annotationList as annotation (annotation.id)}
        <div class="px-3 py-3 border-b border-white/10 space-y-2">
          <AnnotationContent
            content={annotation.content}
            authorName={annotation.authorName}
            createdAt={annotation.createdAt}
          />

          {#if annotation.anchor.type === 'viewport'}
            <span class="text-[10px] bg-amber-100/10 text-amber-400 px-1.5 py-0.5 rounded">Map-level</span>
          {:else if annotation.anchor.type === 'region'}
            <span class="text-[10px] bg-blue-100/10 text-blue-400 px-1.5 py-0.5 rounded">Region</span>
          {/if}

          <!-- Thread controls -->
          <div class="flex gap-2 text-xs">
            <button
              onclick={() => { expandedAnnotationId = expandedAnnotationId === annotation.id ? null : annotation.id; }}
              class="text-slate-400 hover:text-slate-300"
            >
              {expandedAnnotationId === annotation.id ? 'Collapse' : 'Replies'}
            </button>
            {#if annotation.authorId === userId || userId}
              <button
                onclick={() => { replyingTo = replyingTo === annotation.id ? null : annotation.id; replyText = ''; }}
                class="text-blue-400 hover:text-blue-300"
              >
                Reply
              </button>
            {/if}
          </div>

          <!-- Thread replies -->
          {#if expandedAnnotationId === annotation.id}
            {#await trpc.annotations.getThread.query({ rootId: annotation.id })}
              <p class="text-xs text-slate-500 ml-3">Loading replies...</p>
            {:then thread}
              {#each thread.replies as reply (reply.id)}
                <div class="ml-4 border-l-2 border-amber-200/30 pl-2 mt-1">
                  <AnnotationContent
                    content={reply.content}
                    authorName={reply.authorName}
                    createdAt={reply.createdAt}
                  />
                  {#if reply.authorId === userId}
                    <button
                      onclick={() => handleDelete(reply.id)}
                      class="text-xs text-red-400 hover:text-red-300 mt-0.5"
                    >
                      Delete
                    </button>
                  {/if}
                </div>
              {/each}
              {#if thread.replies.length === 0}
                <p class="text-xs text-slate-500 ml-4 italic">No replies yet.</p>
              {/if}
            {:catch}
              <p class="text-xs text-red-400 ml-3">Failed to load replies.</p>
            {/await}
          {/if}

          <!-- Reply form -->
          {#if replyingTo === annotation.id}
            <div class="ml-4 mt-1 flex gap-1">
              <textarea
                bind:value={replyText}
                placeholder="Write a reply..."
                rows={2}
                class="flex-1 rounded bg-slate-700 border border-white/10 px-2 py-1 text-xs text-slate-200 placeholder-slate-500 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
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
  </div>
</div>
