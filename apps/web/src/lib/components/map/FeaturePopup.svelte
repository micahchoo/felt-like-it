<script lang="ts">
  import type { GeoJSONFeature, LayerStyle } from '@felt-like-it/shared-types';
  import { formatAttributeValue } from '$lib/utils/format.js';
  import { MapPin, X } from 'lucide-svelte';

  interface Props {
    feature: GeoJSONFeature;
    /** Optional layer style — drives popup.titleAttribute, popup.keyAttributes, attributes displayName/format */
    style?: LayerStyle;
    onclose?: () => void;
    /**
     * Fires when the user clicks the annotate CTA. Per unified-annotations.md rule 3,
     * feature-click actions route into the annotation panel rather than a separate
     * attribute editor. Caller decides whether to create a new annotation or expand
     * the existing one for this feature.
     */
    onannotate?: () => void;
  }

  let { feature, style, onclose, onannotate }: Props = $props();

  const geomType = $derived(feature.geometry.type);

  /**
   * Build the ordered property entries to display.
   * If popup.keyAttributes is set, show only those keys in that order.
   * Otherwise show all non-internal properties.
   */
  const propEntries = $derived.by(() => {
    const props = feature.properties ?? {};
    const keyAttributes = style?.popup?.keyAttributes;
    if (keyAttributes && keyAttributes.length > 0) {
      return keyAttributes
        .filter((k) => k in props && !k.startsWith('_'))
        .map((k) => [k, props[k]] as [string, unknown]);
    }
    return Object.entries(props).filter(([key]) => !key.startsWith('_'));
  });

  /** Title value from popup.titleAttribute, or null if not configured. */
  const titleValue = $derived.by(() => {
    const titleAttr = style?.popup?.titleAttribute;
    if (!titleAttr) return null;
    const val = feature.properties?.[titleAttr];
    return val !== null && val !== undefined ? String(val) : null;
  });

  /** Feature ID for display — falls back to geomType label. */
  const featureId = $derived(
    feature.id != null ? String(feature.id) : (titleValue ?? geomType)
  );

  /** Coordinates for Point geometry, null otherwise. */
  const coords = $derived.by(() => {
    if (feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates as [number, number];
      return { lat, lng };
    }
    return null;
  });

  function getDisplayName(key: string): string {
    return style?.attributes?.[key]?.displayName ?? key;
  }

  function formatPropValue(key: string, val: unknown): string {
    return formatAttributeValue(val, style?.attributes?.[key]?.format);
  }
</script>

<div class="glass-panel rounded-xl border border-white/5 shadow-2xl w-64 overflow-hidden">
  <!-- Header -->
  <div class="bg-surface-container px-4 pt-4 pb-3 flex items-start justify-between gap-2">
    <div class="flex items-center gap-2 min-w-0">
      <MapPin class="text-primary shrink-0" size={16} />
      <div class="min-w-0">
        <div class="font-display font-semibold text-on-surface text-sm leading-tight truncate" title={featureId}>
          {featureId}
        </div>
        <div class="font-mono text-[10px] text-on-surface-variant mt-0.5 truncate">
          {geomType}
        </div>
      </div>
    </div>
    {#if onclose}
      <button
        onclick={onclose}
        class="shrink-0 rounded-lg p-1 text-on-surface-variant hover:text-on-surface hover:bg-white/5 active:scale-95 transition-all"
        aria-label="Close"
      >
        <X size={14} />
      </button>
    {/if}
  </div>

  <!-- Coordinates stat pair -->
  {#if coords}
    <div class="bg-surface-low border-t border-white/5 px-4 py-3 flex gap-4">
      <div class="flex-1 min-w-0">
        <div class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-0.5">Latitude</div>
        <div class="text-sm font-mono text-on-surface truncate">{coords.lat.toFixed(6)}</div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant mb-0.5">Longitude</div>
        <div class="text-sm font-mono text-on-surface truncate">{coords.lng.toFixed(6)}</div>
      </div>
    </div>
  {/if}

  <!-- Properties -->
  {#if propEntries.length > 0}
    <div class="bg-surface-low border-t border-white/5 px-4 py-3">
      <dl class="space-y-1.5">
        {#each propEntries as [key, value] (key)}
          <div class="flex gap-2">
            <dt class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant shrink-0 w-20 truncate pt-px" title={getDisplayName(key)}>
              {getDisplayName(key)}
            </dt>
            <dd class="text-sm font-mono text-on-surface min-w-0 truncate" title={formatPropValue(key, value)}>
              {formatPropValue(key, value)}
            </dd>
          </div>
        {/each}
      </dl>
    </div>
  {/if}

  <!-- Annotate CTA — opens the annotation panel focused on this feature. -->
  {#if onannotate}
    <div class="bg-surface-container border-t border-white/5 px-4 py-3">
      <button
        onclick={onannotate}
        class="w-full bg-primary text-on-primary font-bold font-display text-xs uppercase tracking-widest rounded-xl py-2.5 active:scale-95 transition-transform"
      >
        Annotate
      </button>
    </div>
  {/if}
</div>
