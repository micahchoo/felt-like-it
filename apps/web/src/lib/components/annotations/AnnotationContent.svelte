<script lang="ts">
  import type { AnnotationContent } from '@felt-like-it/shared-types';

  interface Props {
    content: AnnotationContent;
    authorName: string;
    /** Date object or ISO-8601 string — displayed in the header. */
    createdAt?: Date | string;
  }

  let { content, authorName, createdAt }: Props = $props();

  function formatDate(value: Date | string): string {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }
</script>

<!--
  Renders a single annotation's content based on its type.
  All six variants (text / emoji / gif / image / link / iiif) are handled
  exhaustively — no default branch needed because the discriminated union
  ensures `content.type` is always one of the six literals.
-->
<div class="text-sm text-slate-200 space-y-2" style="max-width: 22rem">
  <!-- Author + timestamp header -->
  <div class="text-xs text-slate-400">
    <span class="font-medium text-slate-300">{authorName}</span>
    {#if createdAt}
      <span class="mx-1">·</span>
      <span>{formatDate(createdAt)}</span>
    {/if}
  </div>

  <!-- Content area — one branch per discriminated union variant -->
  {#if content.type === 'text'}
    <!-- Plain text note: whitespace preserved, no HTML interpretation -->
    <p class="whitespace-pre-wrap leading-relaxed text-slate-200">{content.text}</p>

  {:else if content.type === 'emoji'}
    <!-- Emoji pin: large glyph + optional label below -->
    <div class="flex flex-col items-center gap-1 py-1">
      <span class="text-5xl leading-none" role="img" aria-label={content.label ?? content.emoji}>
        {content.emoji}
      </span>
      {#if content.label}
        <span class="text-xs text-slate-400">{content.label}</span>
      {/if}
    </div>

  {:else if content.type === 'gif'}
    <!-- Animated GIF: constrained height, lazy-loaded -->
    <figure class="m-0 space-y-1">
      <img
        src={content.url}
        alt={content.altText ?? 'Animated GIF'}
        class="rounded max-w-full object-contain"
        style="max-height: 12rem"
        loading="lazy"
      />
      {#if content.altText}
        <figcaption class="text-xs text-slate-400 italic">{content.altText}</figcaption>
      {/if}
    </figure>

  {:else if content.type === 'image'}
    <!-- Static image: constrained height, lazy-loaded -->
    <figure class="m-0 space-y-1">
      <img
        src={content.url}
        alt={content.caption ?? 'Image annotation'}
        class="rounded max-w-full object-contain"
        style="max-height: 12rem"
        loading="lazy"
      />
      {#if content.caption}
        <figcaption class="text-xs text-slate-400">{content.caption}</figcaption>
      {/if}
    </figure>

  {:else if content.type === 'link'}
    <!-- Link card: title + description + URL -->
    <a
      href={content.url}
      target="_blank"
      rel="noopener noreferrer"
      class="block rounded border border-white/10 bg-slate-700 px-3 py-2 hover:bg-slate-600 transition-colors space-y-0.5"
    >
      {#if content.title}
        <p class="font-medium text-slate-200 truncate text-sm">{content.title}</p>
      {/if}
      {#if content.description}
        <p class="text-xs text-slate-400" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden">
          {content.description}
        </p>
      {/if}
      <p class="text-xs text-blue-400 truncate">{content.url}</p>
    </a>

  {:else if content.type === 'iiif'}
    <!-- IIIF manifest card: labelled badge + manifest link + navPlace summary -->
    <div class="rounded border border-amber-400/30 bg-slate-700 px-3 py-2 space-y-1.5">
      <p class="text-[10px] font-bold text-amber-400 uppercase tracking-widest">IIIF Manifest</p>
      {#if content.label}
        <p class="font-medium text-slate-200 text-sm">{content.label}</p>
      {/if}
      <a
        href={content.manifestUrl}
        target="_blank"
        rel="noopener noreferrer"
        class="block text-xs text-blue-400 truncate hover:underline"
        title={content.manifestUrl}
      >
        {content.manifestUrl}
      </a>
      {#if content.navPlace}
        <p class="text-xs text-slate-400">
          NavPlace: {content.navPlace.features.length}
          {content.navPlace.features.length === 1 ? 'feature' : 'features'}
        </p>
      {:else}
        <p class="text-xs text-slate-500 italic">No NavPlace geographic footprint</p>
      {/if}
    </div>
  {/if}
</div>
