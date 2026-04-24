<script lang="ts">
  import exifr from 'exifr';
  import { Type, Smile, Film, ImageIcon, Link2, Waypoints } from 'lucide-svelte';
  import type { Anchor, AnnotationContent as AC } from '@felt-like-it/shared-types';
  import type { SaveAsAnnotationPayload } from '$lib/stores/measurement-store.svelte.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';

  const CONTENT_TYPES = ['text', 'emoji', 'gif', 'image', 'link', 'iiif'] as const;
  type ContentType = (typeof CONTENT_TYPES)[number];

  const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
    text: 'Text',
    emoji: 'Emoji',
    gif: 'GIF',
    image: 'Image',
    link: 'Link',
    iiif: 'IIIF',
  };

  const CONTENT_TYPE_ICONS: Record<ContentType, typeof Type> = {
    text: Type,
    emoji: Smile,
    gif: Film,
    image: ImageIcon,
    link: Link2,
    iiif: Waypoints,
  };

  interface Props {
    mapId: string;
    oncreate: (input: {
      mapId: string;
      anchor: Anchor;
      content: { kind: 'single'; body: AC };
      name?: string;
      description?: string;
    }) => void;
    pendingMeasurementData: SaveAsAnnotationPayload | null;
    regionGeometry?: { type: 'Polygon'; coordinates: number[][][] } | undefined;
    pickedFeature?: { featureId: string; layerId: string } | undefined;
    onrequestregion?: () => void;
    onrequestfeaturepick?: () => void;
    /** True while the create mutation is in flight — prevents double-submit. */
    isSubmitting?: boolean;
  }

  let {
    mapId,
    oncreate,
    pendingMeasurementData,
    regionGeometry = undefined,
    pickedFeature = undefined,
    onrequestregion,
    onrequestfeaturepick,
    isSubmitting = false,
  }: Props = $props();

  // Form state
  let formName = $state('');
  let formDescription = $state('');
  let formType = $state<ContentType>('text');
  let formText = $state('');
  let formEmoji = $state('');
  let formEmojiLabel = $state('');
  let formGifUrl = $state('');
  let formAltText = $state('');
  let formImageUrl = $state('');
  let formCaption = $state('');
  let formLinkUrl = $state('');
  let formLinkTitle = $state('');
  let formLinkDesc = $state('');
  let formManifestUrl = $state('');
  let formIiifLabel = $state('');
  let fieldErrors: Record<string, string> = $state({});

  // Image upload state
  let selectedImageFile = $state<File | null>(null);
  let imagePreviewUrl = $state<string | null>(null);
  let gpsExtracted = $state(false);
  let parsingExif = $state(false);
  let uploading = $state(false);

  // Anchor state. Measurement is authored via MeasurementPanel + pendingMeasurementData
  // (see below) — a dedicated drawing flow, not a form-selectable type. Keeping it out
  // of the selector avoids two competing authoring paths for the same anchor kind.
  let formAnchorType = $state<'point' | 'region' | 'viewport' | 'feature'>('point');
  let formLng = $state(0);
  let formLat = $state(0);

  // Pre-fill from measurement data
  $effect(() => {
    if (pendingMeasurementData) {
      formType = 'text';
      formText = pendingMeasurementData.content;
    }
  });

  function validateUrl(field: string, value: string) {
    if (!value.trim()) {
      const { [field]: _, ...rest } = fieldErrors;
      fieldErrors = rest;
      return;
    }
    try {
      new URL(value);
      const { [field]: _, ...rest } = fieldErrors;
      fieldErrors = rest;
    } catch {
      fieldErrors = { ...fieldErrors, [field]: 'Enter a valid URL.' };
    }
  }

  async function handleImageFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      imagePreviewUrl = null;
    }
    gpsExtracted = false;
    selectedImageFile = file;
    if (!file) return;
    imagePreviewUrl = URL.createObjectURL(file);
    parsingExif = true;
    try {
      const gps = await exifr.gps(file);
      if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
        formLat = Math.round(gps.latitude * 1_000_000) / 1_000_000;
        formLng = Math.round(gps.longitude * 1_000_000) / 1_000_000;
        gpsExtracted = true;
      }
    } catch {
      /* non-fatal */
    } finally {
      parsingExif = false;
    }
  }

  async function uploadImageFile(file: File): Promise<string> {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/annotation-upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(body || `Upload failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as { url?: string };
    if (typeof data.url !== 'string') throw new Error('Upload returned no URL');
    return data.url;
  }

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

  function buildAnchor(): Anchor {
    if (formAnchorType === 'region' && regionGeometry)
      return {
        type: 'region',
        geometry: regionGeometry as {
          type: 'Polygon';
          coordinates: ([number, number] | [number, number, number])[][];
        },
      };
    if (formAnchorType === 'feature' && pickedFeature)
      return {
        type: 'feature',
        featureId: pickedFeature.featureId,
        layerId: pickedFeature.layerId,
      };
    if (formAnchorType === 'viewport') return { type: 'viewport' };
    return { type: 'point', geometry: { type: 'Point', coordinates: [formLng, formLat] } };
  }

  const canSubmit = $derived(
    !(
      uploading ||
      parsingExif ||
      (formType === 'text' && !formText.trim()) ||
      (formType === 'emoji' && !formEmoji.trim()) ||
      (formType === 'gif' && !formGifUrl.trim()) ||
      (formType === 'image' && !formImageUrl && !selectedImageFile) ||
      (formType === 'link' && !formLinkUrl.trim()) ||
      (formType === 'iiif' && !formManifestUrl.trim()) ||
      (formAnchorType === 'region' && !regionGeometry) ||
      (formAnchorType === 'feature' && !pickedFeature)
    )
  );

  async function handleSubmit(e: Event) {
    e.preventDefault();
    try {
      if (formType === 'image' && selectedImageFile) {
        uploading = true;
        formImageUrl = '';
        try {
          formImageUrl = await uploadImageFile(selectedImageFile);
        } catch (uploadErr) {
          uploading = false;
          const msg = `Failed to upload ${(selectedImageFile as File).name}: ${(uploadErr as { message?: string })?.message ?? 'unknown error'}`;
          toastStore.error(msg);
          return;
        } finally {
          uploading = false;
        }
      }
      oncreate({
        mapId,
        anchor: buildAnchor(),
        content: { kind: 'single', body: buildContent() },
        ...(formName.trim() ? { name: formName.trim() } : {}),
        ...(formDescription.trim() ? { description: formDescription.trim() } : {}),
      });
      resetForm();
    } catch {
      toastStore.error('Failed to create annotation.');
    }
  }

  function resetForm() {
    formName = '';
    formDescription = '';
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
    fieldErrors = {};
    formAnchorType = 'point';
    formLng = 0;
    formLat = 0;
    if (imagePreviewUrl) {
      URL.revokeObjectURL(imagePreviewUrl);
      imagePreviewUrl = null;
    }
    selectedImageFile = null;
    gpsExtracted = false;
    parsingExif = false;
  }
</script>

<form onsubmit={handleSubmit} class="flex flex-col gap-2 p-3">
  <!-- Name (Felt-parity first-class label; optional) -->
  <div class="flex flex-col gap-1">
    <label class="text-xs text-on-surface-variant" for="ann-name">Name</label>
    <input
      id="ann-name"
      type="text"
      data-testid="annotation-name"
      bind:value={formName}
      maxlength={200}
      placeholder="e.g. Field site A (optional)"
      class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
    />
  </div>

  <!-- Content type grid -->
  <div class="grid grid-cols-3 gap-1.5">
    {#each CONTENT_TYPES as t (t)}
      {@const Icon = CONTENT_TYPE_ICONS[t]}
      <button
        type="button"
        data-testid="content-type-{t}"
        onclick={() => {
          formType = t;
        }}
        class="flex flex-col items-center justify-center p-2.5 rounded-lg transition-all
               {formType === t
          ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
          : 'bg-surface-low text-on-surface-variant hover:bg-surface-high'}"
      >
        {#if Icon}<Icon size={18} strokeWidth={formType === t ? 2.5 : 1.5} />{/if}
        <span class="text-[9px] font-bold uppercase tracking-wider mt-1"
          >{CONTENT_TYPE_LABELS[t]}</span
        >
      </button>
    {/each}
  </div>

  <!-- Per-type fields -->
  {#if formType === 'text'}
    <div class="flex flex-col gap-1">
      <label class="text-xs text-on-surface-variant" for="ann-text">Note</label>
      <textarea
        id="ann-text"
        data-testid="content-text"
        bind:value={formText}
        rows={3}
        placeholder="Write your note…"
        class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
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
          class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      <div class="flex flex-col gap-1 flex-1">
        <label class="text-xs text-on-surface-variant" for="ann-emoji-label"
          >Label <span class="text-on-surface-variant/70">(optional)</span></label
        >
        <input
          id="ann-emoji-label"
          type="text"
          bind:value={formEmojiLabel}
          placeholder="Short label"
          class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
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
        onblur={() => validateUrl('gifUrl', formGifUrl)}
        placeholder="https://media.tenor.com/…"
        class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {#if fieldErrors.gifUrl}<p class="text-[11px] text-error">{fieldErrors.gifUrl}</p>{/if}
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-xs text-on-surface-variant" for="ann-alt"
        >Alt text <span class="text-on-surface-variant/70">(optional)</span></label
      >
      <input
        id="ann-alt"
        type="text"
        bind:value={formAltText}
        placeholder="Accessible description"
        class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  {:else if formType === 'image'}
    <div class="flex flex-col gap-1">
      <label class="text-xs text-on-surface-variant" for="ann-image-file">Upload image</label>
      <input
        id="ann-image-file"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        onchange={handleImageFileSelect}
        class="w-full text-xs text-on-surface file:mr-2 file:rounded file:border-0 file:bg-surface-low file:px-2 file:py-1 file:text-xs file:text-on-surface hover:file:bg-surface-high"
      />
    </div>
    {#if imagePreviewUrl}
      <div class="relative">
        <img
          src={imagePreviewUrl}
          alt="Selected file preview"
          class="rounded w-full object-contain bg-surface-lowest"
          style="max-height: 8rem"
        />
        {#if gpsExtracted}<span
            class="absolute top-1 right-1 rounded-full bg-green-600/90 px-2 py-0.5 text-[10px] font-semibold text-white"
            title="GPS from EXIF">📍 GPS from EXIF</span
          >{/if}
      </div>
    {/if}
    <div class="flex flex-col gap-1">
      <label class="text-xs text-on-surface-variant" for="ann-image-url">Image URL</label>
      <input
        id="ann-image-url"
        type="url"
        bind:value={formImageUrl}
        onblur={() => validateUrl('imageUrl', formImageUrl)}
        placeholder="https://example.com/photo.jpg"
        class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {#if fieldErrors.imageUrl}<p class="text-[11px] text-error">{fieldErrors.imageUrl}</p>{/if}
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-xs text-on-surface-variant" for="ann-caption"
        >Caption <span class="text-on-surface-variant/70">(optional)</span></label
      >
      <input
        id="ann-caption"
        type="text"
        bind:value={formCaption}
        placeholder="Caption"
        class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  {:else if formType === 'link'}
    <div class="flex flex-col gap-1">
      <label class="text-xs text-on-surface-variant" for="ann-link-url">URL</label>
      <input
        id="ann-link-url"
        type="url"
        bind:value={formLinkUrl}
        onblur={() => validateUrl('linkUrl', formLinkUrl)}
        placeholder="https://example.com"
        class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {#if fieldErrors.linkUrl}<p class="text-[11px] text-error">{fieldErrors.linkUrl}</p>{/if}
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-xs text-on-surface-variant" for="ann-link-title"
        >Title <span class="text-on-surface-variant/70">(optional)</span></label
      >
      <input
        id="ann-link-title"
        type="text"
        bind:value={formLinkTitle}
        placeholder="Link title"
        class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-xs text-on-surface-variant" for="ann-link-desc"
        >Description <span class="text-on-surface-variant/70">(optional)</span></label
      >
      <input
        id="ann-link-desc"
        type="text"
        bind:value={formLinkDesc}
        placeholder="Brief description"
        class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  {:else if formType === 'iiif'}
    <div class="flex flex-col gap-1">
      <label class="text-xs text-on-surface-variant" for="ann-manifest">Manifest URL</label>
      <input
        id="ann-manifest"
        type="url"
        bind:value={formManifestUrl}
        onblur={() => validateUrl('manifestUrl', formManifestUrl)}
        placeholder="https://example.org/iiif/manifest.json"
        class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {#if fieldErrors.manifestUrl}<p class="text-[11px] text-error">
          {fieldErrors.manifestUrl}
        </p>{/if}
    </div>
    <div class="flex flex-col gap-1">
      <label class="text-xs text-on-surface-variant" for="ann-iiif-label"
        >Label <span class="text-on-surface-variant/70">(optional)</span></label
      >
      <input
        id="ann-iiif-label"
        type="text"
        bind:value={formIiifLabel}
        placeholder="Manuscript title"
        class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
      />
    </div>
  {/if}

  <!-- Measurement data display -->
  {#if pendingMeasurementData}
    <div class="px-2 py-1 rounded bg-primary/10 border border-primary/20 text-xs text-primary">
      {pendingMeasurementData.title}
    </div>
  {/if}

  <!-- Description (optional rich body; Felt-parity) -->
  <div class="flex flex-col gap-1">
    <label class="text-xs text-on-surface-variant" for="ann-description">Description</label>
    <textarea
      id="ann-description"
      data-testid="annotation-description"
      bind:value={formDescription}
      rows={2}
      maxlength={5000}
      placeholder="Longer notes that show when readers open the annotation (optional)"
      class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
    ></textarea>
  </div>

  <!-- Anchor selection -->
  <fieldset class="flex flex-col gap-1 mt-2 border-t border-white/5 pt-2">
    <legend class="text-[10px] uppercase tracking-wider text-on-surface-variant/70">
      Where should this annotation live?
    </legend>
    <div class="grid grid-cols-4 gap-1.5">
      {#each [{ v: 'point', label: 'Point' }, { v: 'region', label: 'Region' }, { v: 'feature', label: 'Feature' }, { v: 'viewport', label: 'Viewport' }] as opt (opt.v)}
        <button
          type="button"
          data-testid="anchor-type-{opt.v}"
          onclick={() => {
            formAnchorType = opt.v as typeof formAnchorType;
          }}
          class="px-2 py-1 rounded text-[10px] font-semibold uppercase tracking-wider transition-colors
                 {formAnchorType === opt.v
            ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20'
            : 'bg-surface-low text-on-surface-variant hover:bg-surface-high'}"
        >
          {opt.label}
        </button>
      {/each}
    </div>

    {#if formAnchorType === 'point'}
      <div class="grid grid-cols-2 gap-1 mt-1">
        <label class="flex flex-col text-[10px] text-on-surface-variant">
          Longitude
          <input
            type="number"
            step="any"
            min={-180}
            max={180}
            bind:value={formLng}
            class="rounded bg-surface-low border border-white/5 px-2 py-1 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
        <label class="flex flex-col text-[10px] text-on-surface-variant">
          Latitude
          <input
            type="number"
            step="any"
            min={-90}
            max={90}
            bind:value={formLat}
            class="rounded bg-surface-low border border-white/5 px-2 py-1 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </label>
      </div>
    {:else if formAnchorType === 'region'}
      <div class="flex items-center gap-2 mt-1">
        <button
          type="button"
          onclick={() => onrequestregion?.()}
          class="px-2 py-1 rounded text-[10px] bg-surface-low text-on-surface-variant hover:bg-surface-high"
        >
          {regionGeometry ? 'Redraw region' : 'Draw region on map'}
        </button>
        {#if regionGeometry}
          <span class="text-[10px] text-emerald-400">✓ region captured</span>
        {:else}
          <span class="text-[10px] text-on-surface-variant/70">no region yet</span>
        {/if}
      </div>
    {:else if formAnchorType === 'feature'}
      <div class="flex items-center gap-2 mt-1">
        <button
          type="button"
          onclick={() => onrequestfeaturepick?.()}
          class="px-2 py-1 rounded text-[10px] bg-surface-low text-on-surface-variant hover:bg-surface-high"
        >
          {pickedFeature ? 'Pick a different feature' : 'Pick a feature on the map'}
        </button>
        {#if pickedFeature}
          <span class="text-[10px] text-emerald-400">✓ feature selected</span>
        {:else}
          <span class="text-[10px] text-on-surface-variant/70">no feature yet</span>
        {/if}
      </div>
    {:else if formAnchorType === 'viewport'}
      <p class="text-[10px] text-on-surface-variant/70 mt-1">
        Attached to the current map view. Readers will see the note whenever this view is loaded.
      </p>
    {/if}
  </fieldset>

  <!-- Measurement data display -->

  <!-- Submit -->
  <button
    type="submit"
    data-testid="annotation-save"
    disabled={!canSubmit || isSubmitting}
    class="px-3 py-1.5 rounded bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
  >
    {isSubmitting ? 'Saving…' : 'Save'}
  </button>
</form>
