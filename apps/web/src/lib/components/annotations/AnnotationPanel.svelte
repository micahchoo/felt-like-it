<script lang="ts">
  import { trpc } from '$lib/utils/trpc.js';
  import Button from '$lib/components/ui/Button.svelte';
  import AnnotationContent from './AnnotationContent.svelte';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import type { Annotation, AnnotationContent as AC } from '@felt-like-it/shared-types';
  import { AnnotationContentSchema } from '@felt-like-it/shared-types';

  interface Props {
    mapId: string;
    /** Authenticated user id — used to gate edit / delete buttons. */
    userId?: string;
    /** Called after any mutation (create / delete) so the parent can refresh the map pins. */
    onannotationchange: () => void;
  }

  let { mapId, userId, onannotationchange }: Props = $props();

  // ── Annotation list ────────────────────────────────────────────────────────

  /**
   * Local annotation entry — tRPC serialises Date to ISO-8601 string in JSON,
   * so `createdAt` / `updatedAt` arrive as strings on the client.
   * Define a mirror interface rather than importing server-only types.
   */
  interface AnnotationEntry extends Omit<Annotation, 'createdAt' | 'updatedAt'> {
    createdAt: string;
    updatedAt: string;
  }

  let annotationList = $state<AnnotationEntry[]>([]);
  let listLoading = $state(false);
  let listError = $state<string | null>(null);

  async function loadAnnotations() {
    listLoading = true;
    listError = null;
    try {
      const rows = await trpc.annotations.list.query({ mapId });
      annotationList = rows as unknown as AnnotationEntry[];
    } catch (err: unknown) {
      listError = (err as { message?: string })?.message ?? 'Failed to load annotations.';
    } finally {
      listLoading = false;
    }
  }

  $effect(() => { loadAnnotations(); });

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

  // GIF / Image (shared URL + alt/caption fields)
  let formUrl = $state('');
  let formAltText = $state('');
  let formCaption = $state('');

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

  $effect.pre(() => {
    if (formLng === 0 && formLat === 0) {
      const [lng, lat] = mapStore.center;
      formLng = Math.round(lng * 1_000_000) / 1_000_000;
      formLat = Math.round(lat * 1_000_000) / 1_000_000;
    }
  });

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
          url: formUrl,
          ...(formAltText.trim() ? { altText: formAltText.trim() } : {}),
        };
      case 'image':
        return {
          type: 'image',
          url: formUrl,
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

  async function handleCreate(e: Event) {
    e.preventDefault();
    creating = true;
    createError = null;
    try {
      // Client-side validation before sending — catches issues before the round-trip
      const content = buildContent();
      AnnotationContentSchema.parse(content);

      await trpc.annotations.create.mutate({
        mapId,
        anchor: { type: 'Point', coordinates: [formLng, formLat] },
        content,
      });

      showForm = false;
      // Reset text fields so the form is clean on next open
      formText = '';
      formEmoji = '';
      formEmojiLabel = '';
      formUrl = '';
      formAltText = '';
      formCaption = '';
      formLinkUrl = '';
      formLinkTitle = '';
      formLinkDesc = '';
      formManifestUrl = '';
      formIiifLabel = '';

      await loadAnnotations();
      onannotationchange();
    } catch (err: unknown) {
      createError = (err as { message?: string })?.message ?? 'Failed to create annotation.';
    } finally {
      creating = false;
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
  async function handleFetchNavPlace(annotation: AnnotationEntry) {
    if (annotation.content.type !== 'iiif') return;
    try {
      const navPlace = await trpc.annotations.fetchIiifNavPlace.query({
        manifestUrl: annotation.content.manifestUrl,
      });
      if (navPlace) {
        await trpc.annotations.update.mutate({
          id: annotation.id,
          content: { ...annotation.content, navPlace },
        });
        await loadAnnotations();
        onannotationchange();
      }
    } catch {
      // Best-effort — don't surface NavPlace fetch errors as blocking UI errors
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

      <!-- Text fields per content type -->
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
            <label class="text-xs text-slate-400" for="ann-emoji-label">Label <span class="text-slate-500">(optional)</span></label>
            <input
              id="ann-emoji-label"
              type="text"
              bind:value={formEmojiLabel}
              placeholder="Short label"
              class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

      {:else if formType === 'gif' || formType === 'image'}
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-url">URL</label>
          <input
            id="ann-url"
            type="url"
            bind:value={formUrl}
            placeholder={formType === 'gif' ? 'https://media.tenor.com/…' : 'https://example.com/photo.jpg'}
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-alt">
            {formType === 'gif' ? 'Alt text' : 'Caption'} <span class="text-slate-500">(optional)</span>
          </label>
          {#if formType === 'gif'}
            <input
              id="ann-alt"
              type="text"
              bind:value={formAltText}
              placeholder="Accessible description"
              class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          {:else}
            <input
              id="ann-alt"
              type="text"
              bind:value={formCaption}
              placeholder="Caption"
              class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          {/if}
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
          <label class="text-xs text-slate-400" for="ann-link-title">Title <span class="text-slate-500">(optional)</span></label>
          <input
            id="ann-link-title"
            type="text"
            bind:value={formLinkTitle}
            placeholder="Link title"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-xs text-slate-400" for="ann-link-desc">Description <span class="text-slate-500">(optional)</span></label>
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
          <label class="text-xs text-slate-400" for="ann-iiif-label">Label <span class="text-slate-500">(optional)</span></label>
          <input
            id="ann-iiif-label"
            type="text"
            bind:value={formIiifLabel}
            placeholder="Manuscript title"
            class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <p class="text-xs text-slate-500 italic">
          NavPlace will be fetched automatically after saving.
        </p>
      {/if}

      <!-- Anchor coordinates -->
      <div class="flex gap-2">
        <div class="flex flex-col gap-1 flex-1">
          <label class="text-xs text-slate-400" for="ann-lng">Lng</label>
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
          <label class="text-xs text-slate-400" for="ann-lat">Lat</label>
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

      {#if createError}
        <p class="text-xs text-red-400">{createError}</p>
      {/if}

      <Button type="submit" size="sm" loading={creating}>Save annotation</Button>
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

          <!-- Actions: fetch NavPlace for IIIF, delete for own annotations -->
          <div class="flex gap-2">
            {#if annotation.content.type === 'iiif' && !annotation.content.navPlace && annotation.userId === userId}
              <button
                onclick={() => handleFetchNavPlace(annotation)}
                class="text-xs text-amber-400 hover:text-amber-300 underline"
              >
                Fetch NavPlace
              </button>
            {/if}
            {#if annotation.userId === userId}
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
