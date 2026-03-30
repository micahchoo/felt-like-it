<script lang="ts">
  import type { AnnotationContent, AnnotationObjectContent } from '@felt-like-it/shared-types';

  interface Props {
    content: AnnotationContent | AnnotationObjectContent;
    authorName: string;
    /** Date object or ISO-8601 string — displayed in the header. */
    createdAt?: Date | string;
    /** Anchor type badge (point, region, viewport, feature, measurement). */
    anchorType?: string;
    /** Whether the anchored feature has been deleted. */
    featureDeleted?: boolean;
    /** Called when the user clicks "Convert to point" on an orphaned annotation. */
    onconverttopoint?: () => void;
    /** Compact mode — used for hover tooltips (hides full content, shows preview). */
    compact?: boolean;
  }

  let { content, authorName, createdAt, anchorType, featureDeleted = false, onconverttopoint, compact = false }: Props = $props();

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
  All seven variants (text / emoji / gif / image / link / iiif / measurement) are handled
  exhaustively — no default branch needed because the discriminated union
  ensures `body.type` is always one of the seven literals.
  Accepts both raw AnnotationContent (legacy) and the AnnotationObjectContent
  wrapper (single/slotted) — the latter is unwrapped before rendering.
-->
<div class="text-sm text-on-surface space-y-2{featureDeleted ? ' opacity-60' : ''}" style="max-width: 22rem">
  {#if featureDeleted}
    <div class="flex items-center gap-1.5 rounded bg-red-500/10 px-2 py-1 text-[11px] text-red-400">
      <span>Feature deleted</span>
      {#if onconverttopoint}
        <button class="underline hover:text-amber-300 text-xs" onclick={onconverttopoint}>Convert to point</button>
      {/if}
    </div>
  {/if}
  <!-- Author + timestamp + anchor type header -->
  <div class="flex items-center gap-1.5 text-xs text-on-surface-variant flex-wrap">
    <span class="font-medium text-on-surface">{authorName}</span>
    {#if createdAt}
      <span class="mx-0.5">·</span>
      <span>{formatDate(createdAt)}</span>
    {/if}
    {#if anchorType}
      <span class="ml-auto inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none
        {anchorType === 'point' ? 'bg-amber-500/20 text-amber-400'
          : anchorType === 'region' ? 'bg-primary/20 text-primary'
          : anchorType === 'feature' ? 'bg-emerald-500/20 text-emerald-400'
          : anchorType === 'measurement' ? 'bg-cyan-500/20 text-cyan-400'
          : 'bg-surface-high/20 text-on-surface-variant'}">
        {anchorType === 'point' ? '📍 Pin'
          : anchorType === 'region' ? '🔲 Region'
          : anchorType === 'feature' ? '🔗 Feature'
          : anchorType === 'measurement' ? '📏 Measurement'
          : anchorType === 'viewport' ? '🗺️ Viewport'
          : anchorType}
      </span>
    {/if}
  </div>

  {#if compact}
    <!-- Compact mode: show text preview only -->
    {@const bodies = getBodies(content)}
    {@const firstText = bodies.find(b => b.type === 'text')}
    {@const firstMeasurement = bodies.find(b => b.type === 'measurement')}
    {#if firstMeasurement && 'displayValue' in firstMeasurement}
      <span class="text-sm font-semibold text-amber-400">{firstMeasurement.displayValue}</span>
    {:else if firstText && 'text' in firstText}
      <p class="text-xs text-on-surface line-clamp-2">{firstText.text}</p>
    {:else if bodies[0]}
      <p class="text-xs text-on-surface-variant italic">{bodies[0].type} annotation</p>
    {/if}
  {:else}

  {#each getBodies(content) as body (body.type)}
    <!-- Content area — one branch per discriminated union variant -->
    {#if body.type === 'text'}
      <!-- Plain text note: whitespace preserved, no HTML interpretation -->
      <p class="whitespace-pre-wrap leading-relaxed text-on-surface">{body.text}</p>

    {:else if body.type === 'emoji'}
      <!-- Emoji pin: large glyph + optional label below -->
      <div class="flex flex-col items-center gap-1 py-1">
        <span class="text-5xl leading-none" role="img" aria-label={body.label ?? body.emoji}>
          {body.emoji}
        </span>
        {#if body.label}
          <span class="text-xs text-on-surface-variant">{body.label}</span>
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
          <figcaption class="text-xs text-on-surface-variant italic">{body.altText}</figcaption>
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
          <figcaption class="text-xs text-on-surface-variant">{body.caption}</figcaption>
        {/if}
      </figure>

    {:else if body.type === 'link'}
      <!-- Link card: title + description + URL -->
      <a
        href={body.url}
        target="_blank"
        rel="noopener noreferrer"
        class="block rounded border border-white/5 bg-surface-low px-3 py-2 hover:bg-surface-high transition-colors space-y-0.5"
      >
        {#if body.title}
          <p class="font-medium text-on-surface truncate text-sm">{body.title}</p>
        {/if}
        {#if body.description}
          <p class="text-xs text-on-surface-variant" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden">
            {body.description}
          </p>
        {/if}
        <p class="text-xs text-primary truncate">{body.url}</p>
      </a>

    {:else if body.type === 'iiif'}
      <!-- IIIF manifest card: labelled badge + manifest link + navPlace summary -->
      <div class="rounded border border-amber-400/30 bg-surface-low px-3 py-2 space-y-1.5">
        <p class="text-[10px] font-bold text-amber-400 uppercase tracking-widest">IIIF Manifest</p>
        {#if body.label}
          <p class="font-medium text-on-surface text-sm">{body.label}</p>
        {/if}
        <a
          href={body.manifestUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="block text-xs text-primary truncate hover:underline"
          title={body.manifestUrl}
        >
          {body.manifestUrl}
        </a>
        {#if body.navPlace}
          <p class="text-xs text-on-surface-variant">
            NavPlace: {body.navPlace.features.length}
            {body.navPlace.features.length === 1 ? 'feature' : 'features'}
          </p>
        {:else}
          <p class="text-xs text-on-surface-variant/70 italic">No NavPlace geographic footprint</p>
        {/if}
      </div>

    {:else if body.type === 'measurement'}
      <!-- Measurement annotation: prominent value + type + optional label -->
      <div class="flex items-baseline gap-2">
        <span class="text-lg font-semibold text-amber-400">{body.displayValue}</span>
        <span class="text-xs text-on-surface-variant capitalize">{body.measurementType}</span>
      </div>
      {#if body.label}
        <p class="text-xs text-on-surface mt-1">{body.label}</p>
      {/if}
    {/if}
  {/each}
  {/if}
</div>
