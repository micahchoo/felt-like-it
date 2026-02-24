<script lang="ts">
  import type { GeoJSONFeature, LayerStyle } from '@felt-like-it/shared-types';
  import { formatAttributeValue } from '$lib/utils/format.js';

  interface Props {
    feature: GeoJSONFeature;
    /** Optional layer style — drives popup.titleAttribute, popup.keyAttributes, attributes displayName/format */
    style?: LayerStyle;
  }

  let { feature, style }: Props = $props();

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

  function getDisplayName(key: string): string {
    return style?.attributes?.[key]?.displayName ?? key;
  }

  function formatPropValue(key: string, val: unknown): string {
    return formatAttributeValue(val, style?.attributes?.[key]?.format);
  }
</script>

<div class="text-sm max-w-xs">
  {#if titleValue}
    <div class="font-semibold text-white mb-1 text-sm leading-tight truncate" title={titleValue}>
      {titleValue}
    </div>
  {/if}
  <div class="font-medium text-slate-300 mb-2 text-xs uppercase tracking-wide">
    {geomType}
  </div>

  {#if propEntries.length === 0}
    <p class="text-slate-400 italic text-xs">No properties</p>
  {:else}
    <dl class="space-y-1">
      {#each propEntries as [key, value] (key)}
        <div class="flex gap-2">
          <dt class="text-slate-400 shrink-0 font-medium text-xs min-w-0 w-24 truncate" title={getDisplayName(key)}>
            {getDisplayName(key)}
          </dt>
          <dd class="text-white text-xs min-w-0 truncate" title={formatPropValue(key, value)}>
            {formatPropValue(key, value)}
          </dd>
        </div>
      {/each}
    </dl>
  {/if}
</div>
