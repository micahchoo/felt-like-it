<script lang="ts">
  import type { AnnotationContent, AnnotationObjectContent } from '@felt-like-it/shared-types';

  interface Props {
    content: AnnotationContent | AnnotationObjectContent;
    authorName: string;
    /** Date object or ISO-8601 string — displayed in the header. */
    createdAt?: Date | string;
  }

  let { content, authorName, createdAt }: Props = $props();

  function formatDate(value: Date | string): string {
    const d = value instanceof Date ? value : new Date(value);
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  // Unwrap AnnotationObjectContent to get renderable bodies
  function getBodies(c: AnnotationContent | AnnotationObjectContent): AnnotationContent[] {
    if ('kind' in c) {
      // AnnotationObjectContent wrapper
      if (c.kind === 'single') return [c.body];
      // slotted: return non-null slots in order
      return Object.values(c.slots).filter((s): s is AnnotationContent => s !== null);
    }
    // Raw AnnotationContent (legacy/direct)
    return [c];
  }
</script>

<!--
  Renders a single annotation's content based on its type.
  All six variants (text / emoji / gif / image / link / iiif) are handled
  exhaustively — no default branch needed because the discriminated union
  ensures `body.type` is always one of the six literals.
  Accepts both raw AnnotationContent (legacy) and the AnnotationObjectContent
  wrapper (single/slotted) — the latter is unwrapped before rendering.
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

  {#each getBodies(content) as body (body.type)}
    <!-- Content area — one branch per discriminated union variant -->
    {#if body.type === 'text'}
      <!-- Plain text note: whitespace preserved, no HTML interpretation -->
      <p class="whitespace-pre-wrap leading-relaxed text-slate-200">{body.text}</p>

    {:else if body.type === 'emoji'}
      <!-- Emoji pin: large glyph + optional label below -->
      <div class="flex flex-col items-center gap-1 py-1">
        <span class="text-5xl leading-none" role="img" aria-label={body.label ?? body.emoji}>
          {body.emoji}
        </span>
        {#if body.label}
          <span class="text-xs text-slate-400">{body.label}</span>
        {/if}
      </div>

    {:else if body.type === 'gif'}
      <!-- Animated GIF: constrained height, lazy-loaded -->
      <figure class="m-0 space-y-1">
        <img
          src={body.url}
          alt={body.altText ?? 'Animated GIF'}
          class="rounded max-w-full object-contain"
          style="max-height: 12rem"
          loading="lazy"
        />
        {#if body.altText}
          <figcaption class="text-xs text-slate-400 italic">{body.altText}</figcaption>
        {/if}
      </figure>

    {:else if body.type === 'image'}
      <!-- Static image: constrained height, lazy-loaded -->
      <figure class="m-0 space-y-1">
        <img
          src={body.url}
          alt={body.caption ?? 'Image annotation'}
          class="rounded max-w-full object-contain"
          style="max-height: 12rem"
          loading="lazy"
        />
        {#if body.caption}
          <figcaption class="text-xs text-slate-400">{body.caption}</figcaption>
        {/if}
      </figure>

    {:else if body.type === 'link'}
      <!-- Link card: title + description + URL -->
      <a
        href={body.url}
        target="_blank"
        rel="noopener noreferrer"
        class="block rounded border border-white/10 bg-slate-700 px-3 py-2 hover:bg-slate-600 transition-colors space-y-0.5"
      >
        {#if body.title}
          <p class="font-medium text-slate-200 truncate text-sm">{body.title}</p>
        {/if}
        {#if body.description}
          <p class="text-xs text-slate-400" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden">
            {body.description}
          </p>
        {/if}
        <p class="text-xs text-blue-400 truncate">{body.url}</p>
      </a>

    {:else if body.type === 'iiif'}
      <!-- IIIF manifest card: labelled badge + manifest link + navPlace summary -->
      <div class="rounded border border-amber-400/30 bg-slate-700 px-3 py-2 space-y-1.5">
        <p class="text-[10px] font-bold text-amber-400 uppercase tracking-widest">IIIF Manifest</p>
        {#if body.label}
          <p class="font-medium text-slate-200 text-sm">{body.label}</p>
        {/if}
        <a
          href={body.manifestUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="block text-xs text-blue-400 truncate hover:underline"
          title={body.manifestUrl}
        >
          {body.manifestUrl}
        </a>
        {#if body.navPlace}
          <p class="text-xs text-slate-400">
            NavPlace: {body.navPlace.features.length}
            {body.navPlace.features.length === 1 ? 'feature' : 'features'}
          </p>
        {:else}
          <p class="text-xs text-slate-500 italic">No NavPlace geographic footprint</p>
        {/if}
      </div>
    {/if}
  {/each}
</div>
