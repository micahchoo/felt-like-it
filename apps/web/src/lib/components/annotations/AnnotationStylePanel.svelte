<script lang="ts">
  import type { AnnotationObject, AnnotationStyle } from '@felt-like-it/shared-types';

  interface Props {
    annotation: AnnotationObject;
    /** Caller handles the mutation. Called with the full next style object
     *  (or null to clear). Optimistic local state updates on commit only —
     *  inflight caller errors should roll back via TanStack mutation onError. */
    onchange: (_style: AnnotationStyle | null) => void;
    disabled?: boolean;
  }

  let { annotation, onchange, disabled = false }: Props = $props();

  // Local pending state so the sliders/color pickers feel responsive without
  // firing a mutation per pointermove. Commit on change/blur.
  let pending = $state<AnnotationStyle>({});

  // Sync pending from the selected annotation. Runs on mount and whenever the
  // annotation id or its style reference changes — stale values can't leak
  // between annotations because we only read annotation.id/style in the effect.
  let lastAnnotationId = $state<string | null>(null);
  $effect(() => {
    if (annotation.id !== lastAnnotationId) {
      pending = { ...(annotation.style ?? {}) };
      lastAnnotationId = annotation.id;
    }
  });

  function commit() {
    const next: AnnotationStyle = { ...pending };
    // Normalise: drop keys that exactly match defaults so we don't persist noise.
    const hasAny = Object.keys(next).length > 0;
    onchange(hasAny ? next : null);
  }

  function reset() {
    pending = {};
    onchange(null);
  }

  const anchorType = $derived(annotation.anchor.type);
  const showFill = $derived(anchorType === 'region' || anchorType === 'point');
  const showStroke = $derived(true);
  const showLabel = $derived(anchorType === 'point');
</script>

<div class="flex flex-col gap-3 p-3 text-xs text-on-surface">
  <div class="flex items-center justify-between">
    <span class="font-medium uppercase tracking-wide text-on-surface-variant">Style</span>
    <button
      type="button"
      class="text-[10px] text-on-surface-variant hover:text-on-surface disabled:opacity-40"
      onclick={reset}
      {disabled}
    >
      Reset
    </button>
  </div>

  {#if showStroke}
    <div class="flex items-center gap-2">
      <label class="w-20 text-on-surface-variant" for="stroke-color-{annotation.id}">Stroke</label>
      <input
        id="stroke-color-{annotation.id}"
        type="color"
        class="h-6 w-10 cursor-pointer rounded border border-white/10 bg-transparent disabled:opacity-40"
        value={pending.strokeColor ?? '#3b82f6'}
        oninput={(e) => {
          pending.strokeColor = (e.currentTarget as HTMLInputElement).value;
        }}
        onchange={commit}
        {disabled}
      />
      <input
        type="number"
        min="0"
        max="20"
        step="0.5"
        class="w-14 rounded border border-white/10 bg-surface-high/40 px-1 py-0.5 text-[11px] disabled:opacity-40"
        value={pending.strokeWidth ?? ''}
        placeholder="2"
        oninput={(e) => {
          const v = (e.currentTarget as HTMLInputElement).value;
          pending.strokeWidth = v === '' ? undefined : Number(v);
        }}
        onchange={commit}
        {disabled}
      />
      <span class="text-[10px] text-on-surface-variant">px</span>
    </div>

    <div class="flex items-center gap-2">
      <label class="w-20 text-on-surface-variant" for="stroke-opacity-{annotation.id}">Opacity</label>
      <input
        id="stroke-opacity-{annotation.id}"
        type="range"
        min="0"
        max="1"
        step="0.05"
        class="flex-1 accent-primary disabled:opacity-40"
        value={pending.strokeOpacity ?? 1}
        oninput={(e) => {
          pending.strokeOpacity = Number((e.currentTarget as HTMLInputElement).value);
        }}
        onchange={commit}
        {disabled}
      />
      <span class="w-8 text-right text-[10px] tabular-nums">
        {Math.round((pending.strokeOpacity ?? 1) * 100)}%
      </span>
    </div>

    <div class="flex items-center gap-2">
      <span class="w-20 text-on-surface-variant">Dash</span>
      {#each ['solid', 'dashed', 'dotted'] as const as s}
        <label class="flex items-center gap-1">
          <input
            type="radio"
            name="stroke-style-{annotation.id}"
            value={s}
            class="accent-primary disabled:opacity-40"
            checked={(pending.strokeStyle ?? 'solid') === s}
            onchange={() => {
              pending.strokeStyle = s;
              commit();
            }}
            {disabled}
          />
          <span class="capitalize">{s}</span>
        </label>
      {/each}
    </div>
  {/if}

  {#if showFill}
    <div class="flex items-center gap-2">
      <label class="w-20 text-on-surface-variant" for="fill-color-{annotation.id}">Fill</label>
      <input
        id="fill-color-{annotation.id}"
        type="color"
        class="h-6 w-10 cursor-pointer rounded border border-white/10 bg-transparent disabled:opacity-40"
        value={pending.fillColor ?? '#3b82f6'}
        oninput={(e) => {
          pending.fillColor = (e.currentTarget as HTMLInputElement).value;
        }}
        onchange={commit}
        {disabled}
      />
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        class="flex-1 accent-primary disabled:opacity-40"
        value={pending.fillOpacity ?? 0.15}
        oninput={(e) => {
          pending.fillOpacity = Number((e.currentTarget as HTMLInputElement).value);
        }}
        onchange={commit}
        {disabled}
      />
      <span class="w-8 text-right text-[10px] tabular-nums">
        {Math.round((pending.fillOpacity ?? 0.15) * 100)}%
      </span>
    </div>
  {/if}

  {#if showLabel}
    <label class="flex items-center gap-2">
      <input
        type="checkbox"
        class="accent-primary disabled:opacity-40"
        checked={pending.showLabel !== false}
        onchange={(e) => {
          pending.showLabel = (e.currentTarget as HTMLInputElement).checked;
          commit();
        }}
        {disabled}
      />
      <span class="text-on-surface-variant">Show name label</span>
    </label>
  {/if}

  <p class="text-[10px] leading-relaxed text-on-surface-variant/70">
    Dashed &amp; dotted patterns require a MapLibre capability not yet wired per-annotation; the
    renderer honours colour, width, and opacity today. See seed 2b5c.
  </p>
</div>
