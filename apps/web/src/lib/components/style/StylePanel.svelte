<script lang="ts">
  import { styleStore } from '$lib/stores/style.svelte.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { trpc } from '$lib/utils/trpc.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import type { LayerStyle, GeoJSONFeature } from '@felt-like-it/shared-types';
  import {
    isNumericColumn,
    generateChoroplethStyle,
    COLOR_RAMP_NAMES,
    getColorRamp,
    type ColorRampName,
    type ClassificationMethod,
  } from '@felt-like-it/geo-engine';

  interface Props {
    /** GeoJSON features for the layer currently being styled.
     *  Supplied by MapEditor from its layerData cache; used to detect
     *  numeric property names for the choropleth attribute picker. */
    layerFeatures?: GeoJSONFeature[];
  }

  let { layerFeatures = [] }: Props = $props();

  const layer = $derived(
    styleStore.editingLayerId
      ? layersStore.all.find((l) => l.id === styleStore.editingLayerId)
      : null
  );

  const style = $derived(layer?.style as LayerStyle | null | undefined);

  // ── Numeric property detection ─────────────────────────────────────────────
  // Derived from layerFeatures so the attribute picker stays in sync with data.

  const numericProperties = $derived((() => {
    if (layerFeatures.length === 0) return [];
    const first = layerFeatures[0];
    if (!first?.properties) return [];
    const props = Object.keys(first.properties);
    return props.filter((k) => {
      const vals = layerFeatures
        .map((f) => f.properties?.[k])
        .filter((v) => v !== null && v !== undefined);
      return isNumericColumn(vals);
    });
  })());

  // ── All property names (for FSL attribute selectors) ──────────────────────
  const allProperties = $derived((() => {
    if (layerFeatures.length === 0) return [];
    const first = layerFeatures[0];
    if (!first?.properties) return [];
    return Object.keys(first.properties);
  })());

  // ── Simple style controls ──────────────────────────────────────────────────

  let saving = $state(false);
  let dirty = $state(false);
  /** Last style acknowledged by the server — used to revert on save failure or user request. */
  let lastSavedStyle = $state<LayerStyle | null>(null);

  // Pending local edits for continuous inputs (color picker, opacity slider).
  // Updated on every oninput — does NOT trigger layersStore (no map re-render per tick).
  // Flushed to both stores on onchange (fires once per drag gesture).
  let pendingColor = $state<string | null>(null);
  let pendingOpacity = $state<number | null>(null);

  const displayColor = $derived(pendingColor ?? getColor());
  const displayOpacity = $derived(pendingOpacity ?? getOpacity());

  // Capture the server-acknowledged style when the panel opens (before any edits).
  $effect(() => {
    if (layer && style && !dirty) {
      lastSavedStyle = structuredClone(style) as LayerStyle;
    }
  });

  function getColor(): string {
    if (!style) return '#3b82f6';
    const paint = (style.paint as Record<string, unknown>) ?? {};
    const key = layer?.type === 'line'
      ? 'line-color'
      : layer?.type === 'polygon'
      ? 'fill-color'
      : 'circle-color';
    const val = paint[key];
    return typeof val === 'string' ? val : '#3b82f6';
  }

  function getOpacity(): number {
    if (!style) return 0.85;
    const paint = (style.paint as Record<string, unknown>) ?? {};
    const key = layer?.type === 'line'
      ? 'line-opacity'
      : layer?.type === 'polygon'
      ? 'fill-opacity'
      : 'circle-opacity';
    const val = paint[key];
    return typeof val === 'number' ? val : 0.85;
  }

  function colorKey(): string {
    return layer?.type === 'line' ? 'line-color' : layer?.type === 'polygon' ? 'fill-color' : 'circle-color';
  }

  function opacityKey(): string {
    return layer?.type === 'line' ? 'line-opacity' : layer?.type === 'polygon' ? 'fill-opacity' : 'circle-opacity';
  }

  /** oninput: update local preview only — no map re-render per tick. */
  function previewColor(color: string) {
    pendingColor = color;
    dirty = true;
  }

  /** onchange: flush to stores once per drag gesture — triggers one map re-render. */
  function commitColor(color: string) {
    pendingColor = null;
    if (!layer || !style) return;
    const newStyle: LayerStyle = { ...style, paint: { ...(style.paint as Record<string, unknown>), [colorKey()]: color } };
    styleStore.setStyle(layer.id, newStyle);
    layersStore.updateStyle(layer.id, newStyle);
  }

  /** oninput: update local preview only — no map re-render per tick. */
  function previewOpacity(opacity: number) {
    pendingOpacity = opacity;
    dirty = true;
  }

  /** onchange: flush to stores once per drag gesture — triggers one map re-render. */
  function commitOpacity(opacity: number) {
    pendingOpacity = null;
    if (!layer || !style) return;
    const newStyle: LayerStyle = { ...style, paint: { ...(style.paint as Record<string, unknown>), [opacityKey()]: opacity } };
    styleStore.setStyle(layer.id, newStyle);
    layersStore.updateStyle(layer.id, newStyle);
  }

  function revertStyle() {
    if (!lastSavedStyle || !layer) return;
    styleStore.setStyle(layer.id, lastSavedStyle);
    layersStore.updateStyle(layer.id, lastSavedStyle);
    pendingColor = null;
    pendingOpacity = null;
    dirty = false;
  }

  async function saveStyle() {
    if (!layer || !style) return;
    saving = true;
    try {
      await trpc.layers.update.mutate({ id: layer.id, style, version: layer.version });
      toastStore.success('Style saved.');
      dirty = false;
    } catch {
      toastStore.error('Failed to save style. Reverting changes.');
      // Revert optimistic state to what the server last acknowledged
      if (lastSavedStyle && layer) {
        styleStore.setStyle(layer.id, lastSavedStyle);
        layersStore.updateStyle(layer.id, lastSavedStyle);
      }
      dirty = false;
    } finally {
      saving = false;
    }
  }

  // ── FSL property editors ──────────────────────────────────────────────────

  function updateStyleField<K extends keyof LayerStyle>(key: K, value: LayerStyle[K]) {
    if (!layer || !style) return;
    const newStyle: LayerStyle = { ...style, [key]: value };
    styleStore.setStyle(layer.id, newStyle);
    layersStore.updateStyle(layer.id, newStyle);
  }

  function updateConfig(patch: Record<string, unknown>) {
    if (!layer || !style) return;
    const newStyle: LayerStyle = {
      ...style,
      config: { ...style.config, ...patch },
    };
    styleStore.setStyle(layer.id, newStyle);
    layersStore.updateStyle(layer.id, newStyle);
  }

  function updatePopup(patch: Record<string, unknown>) {
    if (!layer || !style) return;
    const newStyle: LayerStyle = {
      ...style,
      popup: { ...style.popup, ...patch },
    };
    styleStore.setStyle(layer.id, newStyle);
    layersStore.updateStyle(layer.id, newStyle);
  }

  function updateAttributes(propName: string, displayName: string) {
    if (!layer || !style) return;
    const attrs = { ...(style.attributes ?? {}) };
    if (displayName) {
      attrs[propName] = { ...attrs[propName], displayName };
    } else {
      // Clear display name override
      const { displayName: _, ...rest } = attrs[propName] ?? {};
      if (Object.keys(rest).length === 0) {
        delete attrs[propName];
      } else {
        attrs[propName] = rest;
      }
    }
    updateStyleField('attributes', Object.keys(attrs).length > 0 ? attrs : undefined);
  }

  // Detect unique string values for categorical editor
  const categoricalCandidates = $derived((() => {
    if (layerFeatures.length === 0) return [];
    return allProperties.filter((k) => {
      const vals = layerFeatures
        .map((f) => f.properties?.[k])
        .filter((v) => v !== null && v !== undefined);
      return vals.length > 0 && vals.every((v) => typeof v === 'string') && new Set(vals).size <= 20;
    });
  })());

  // ── Choropleth controls ────────────────────────────────────────────────────

  // Initialise from existing config if the layer already has a numeric style.
  const existingConfig = $derived(style?.config);

  let choroplethAttr     = $state('');
  let choroplethRamp     = $state<ColorRampName>('Blues');
  let choroplethClasses  = $state(5);
  let choroplethMethod   = $state<ClassificationMethod>('quantile');
  let applyingChoropleth = $state(false);

  // Restore state from existing config when the edited layer changes.
  $effect(() => {
    const cfg = existingConfig;
    if (cfg?.numericAttribute) choroplethAttr = cfg.numericAttribute;
    else if (numericProperties.length > 0) choroplethAttr = numericProperties[0] ?? '';
    if (cfg?.nClasses)             choroplethClasses = cfg.nClasses;
    if (cfg?.classificationMethod) choroplethMethod  = cfg.classificationMethod;
    // config.colorRampName is stored by generateChoroplethStyle; validate before using
    if (cfg?.colorRampName && COLOR_RAMP_NAMES.includes(cfg.colorRampName as ColorRampName)) {
      choroplethRamp = cfg.colorRampName as ColorRampName;
    }
  });

  async function applyChoropleth() {
    if (!layer || !choroplethAttr) return;
    const values = layerFeatures
      .map((f) => f.properties?.[choroplethAttr])
      .filter((v) => v !== null && v !== undefined) as number[];

    if (values.length === 0) {
      toastStore.error('No values found for the selected attribute.');
      return;
    }

    const layerType = layer.type === 'mixed' ? 'mixed' : layer.type;
    const newStyle = generateChoroplethStyle(
      layerType,
      choroplethAttr,
      values,
      choroplethRamp,
      choroplethClasses,
      choroplethMethod
    );

    // Preserve non-choropleth fields (labels, popup, etc.) from existing style.
    // newStyle.config already includes colorRampName, classificationMethod, nClasses.
    const merged: LayerStyle = {
      ...style,
      ...newStyle,
    };

    applyingChoropleth = true;
    try {
      await trpc.layers.update.mutate({ id: layer.id, style: merged, version: layer.version });
      styleStore.setStyle(layer.id, merged);
      layersStore.updateStyle(layer.id, merged);
      toastStore.success('Choropleth applied.');
    } catch {
      toastStore.error('Failed to apply choropleth. Reverting changes.');
      if (lastSavedStyle && layer) {
        styleStore.setStyle(layer.id, lastSavedStyle);
        layersStore.updateStyle(layer.id, lastSavedStyle);
      }
    } finally {
      applyingChoropleth = false;
    }
  }

  const showChoropleth = $derived(numericProperties.length > 0);

  // ── Heatmap controls ───────────────────────────────────────────────────────

  // Heatmap is only available for point layers; point count is available from
  // the features already loaded by MapEditor.
  const showHeatmap = $derived(
    layerFeatures.length > 0 && layerFeatures.every((f) => f.geometry?.type === 'Point')
  );

  let heatmapWeightAttr  = $state('');
  let heatmapRadius      = $state(30);
  let heatmapIntensity   = $state(1);
  let applyingHeatmap    = $state(false);

  // Restore from existing config when the edited layer changes.
  $effect(() => {
    const cfg = existingConfig;
    if (cfg?.heatmapRadius)          heatmapRadius     = cfg.heatmapRadius;
    if (cfg?.heatmapIntensity)       heatmapIntensity  = cfg.heatmapIntensity;
    if (cfg?.heatmapWeightAttribute) heatmapWeightAttr = cfg.heatmapWeightAttribute;
    else                             heatmapWeightAttr = '';
  });

  async function applyHeatmap() {
    if (!layer) return;
    const newStyle: LayerStyle = {
      ...style,
      type: 'heatmap',
      paint: {},  // MapLibre paint unused — deck.gl renders the layer
      config: {
        ...existingConfig,
        heatmapRadius,
        heatmapIntensity,
        heatmapWeightAttribute: heatmapWeightAttr || undefined,
      },
    };
    applyingHeatmap = true;
    try {
      await trpc.layers.update.mutate({ id: layer.id, style: newStyle, version: layer.version });
      styleStore.setStyle(layer.id, newStyle);
      layersStore.updateStyle(layer.id, newStyle);
      toastStore.success('Heatmap applied.');
    } catch {
      toastStore.error('Failed to apply heatmap. Reverting changes.');
      if (lastSavedStyle && layer) {
        styleStore.setStyle(layer.id, lastSavedStyle);
        layersStore.updateStyle(layer.id, lastSavedStyle);
      }
    } finally {
      applyingHeatmap = false;
    }
  }

  async function resetToSimple() {
    if (!layer) return;
    const newStyle: LayerStyle = {
      ...style,
      type: 'simple',
      paint: {
        'circle-radius': 6,
        'circle-color': '#3b82f6',
        'circle-opacity': 0.85,
        'circle-stroke-width': 1.5,
        'circle-stroke-color': '#ffffff',
      },
      config: undefined,
    };
    try {
      await trpc.layers.update.mutate({ id: layer.id, style: newStyle, version: layer.version });
      styleStore.setStyle(layer.id, newStyle);
      layersStore.updateStyle(layer.id, newStyle);
      toastStore.success('Reset to simple style.');
    } catch {
      toastStore.error('Failed to reset style.');
    }
  }
</script>

{#if layer && style}
  <aside
    class="w-56 shrink-0 flex flex-col bg-surface-container border-l border-white/5"
    aria-label="Style panel"
  >
    <div class="flex items-center justify-between px-3 py-3 border-b border-white/5">
      <div class="flex items-center gap-2 min-w-0">
        <span class="text-primary text-sm">&#9670;</span>
        <div class="min-w-0">
          <span class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Style</span>
          <p class="text-xs text-on-surface-variant truncate">{layer.name}</p>
        </div>
      </div>
      <button
        onclick={() => {
          if (dirty && !window.confirm('You have unsaved style changes. Discard them?')) return;
          styleStore.setEditingLayer(null);
        }}
        class="text-on-surface-variant hover:text-on-surface transition-colors"
        aria-label="Close style panel"
      >&#10005;</button>
    </div>

    <div class="flex-1 overflow-y-auto p-3 space-y-4">
      <!-- Mapping Mode tabs -->
      <div class="space-y-2">
        <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Mapping Mode</span>
        <div class="flex rounded-lg bg-surface-low p-0.5">
          <span class="flex-1 text-center py-1.5 text-[10px] font-bold uppercase tracking-wide rounded-md transition-colors
                       {style.type === 'simple' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'}">
            Simple
          </span>
          <span class="flex-1 text-center py-1.5 text-[10px] font-bold uppercase tracking-wide rounded-md transition-colors
                       {style.type === 'categorical' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'}">
            Categoric
          </span>
          <span class="flex-1 text-center py-1.5 text-[10px] font-bold uppercase tracking-wide rounded-md transition-colors
                       {style.type === 'numeric' || style.type === 'heatmap' ? 'bg-primary text-on-primary' : 'text-on-surface-variant'}">
            Numeric
          </span>
        </div>
      </div>

      <!-- Color + Colorramp (simple styles only) -->
      {#if style.type === 'simple'}
        <div class="space-y-2">
          <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Colorramp (FSL)</span>
          <div class="flex items-center gap-2">
            <input
              type="color"
              value={displayColor}
              oninput={(e) => previewColor((e.target as HTMLInputElement).value)}
              onchange={(e) => commitColor((e.target as HTMLInputElement).value)}
              class="h-8 w-10 rounded cursor-pointer border-0 bg-transparent p-0"
              aria-label="Layer color"
            />
            <span class="text-xs text-on-surface-variant font-mono">{displayColor}</span>
          </div>
        </div>
      {/if}

      <!-- Composition Layers -->
      <div class="space-y-2 border-t border-white/5 pt-3">
        <span class="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest">Composition Layers</span>

        <!-- Fill Overlay / Opacity -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-1.5">
            <span class="w-3 h-3 rounded-full border-2 border-primary"></span>
            <span class="text-xs text-on-surface">Fill Overlay</span>
          </div>
          <span class="text-[10px] text-on-surface-variant font-mono">{Math.round(displayOpacity * 100)}% opacity</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={displayOpacity}
          oninput={(e) => previewOpacity(parseFloat((e.target as HTMLInputElement).value))}
          onchange={(e) => commitOpacity(parseFloat((e.target as HTMLInputElement).value))}
          class="w-full accent-primary"
          aria-label="Layer opacity"
        />
      </div>

      <!-- ── FSL Properties ───────────────────────────────────────────────── -->
      {#if allProperties.length > 0}
        <div class="border-t border-white/5 pt-3 space-y-3">
          <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Layer Properties</span>

          <!-- Label attribute -->
          <div class="space-y-1">
            <label class="text-xs text-on-surface-variant" for="fsl-label">Label attribute</label>
            <select
              id="fsl-label"
              value={style.config?.labelAttribute ?? ''}
              onchange={(e) => updateConfig({ labelAttribute: (e.target as HTMLSelectElement).value || undefined })}
              class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">None</option>
              {#each allProperties as prop (prop)}
                <option value={prop}>{prop}</option>
              {/each}
            </select>
          </div>

          <!-- Categorical attribute -->
          {#if categoricalCandidates.length > 0}
            <div class="space-y-1">
              <label class="text-xs text-on-surface-variant" for="fsl-categorical">Categorical attribute</label>
              <select
                id="fsl-categorical"
                value={style.config?.categoricalAttribute ?? ''}
                onchange={(e) => {
                  const attr = (e.target as HTMLSelectElement).value || undefined;
                  if (attr) {
                    const vals = [...new Set(
                      layerFeatures
                        .map((f) => f.properties?.[attr])
                        .filter((v): v is string => typeof v === 'string')
                    )];
                    updateConfig({ categoricalAttribute: attr, categories: vals });
                  } else {
                    updateConfig({ categoricalAttribute: undefined, categories: undefined });
                  }
                }}
                class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">None</option>
                {#each categoricalCandidates as prop (prop)}
                  <option value={prop}>{prop}</option>
                {/each}
              </select>
            </div>
          {/if}

          <!-- isClickable toggle -->
          <div class="flex items-center justify-between">
            <span class="text-xs text-on-surface-variant">Clickable</span>
            <button
              type="button"
              onclick={() => updateStyleField('isClickable', style.isClickable === false ? undefined : false)}
              class="relative h-5 w-9 rounded-full transition-colors {style.isClickable !== false ? 'bg-primary-container' : 'bg-surface-high'}"
              role="switch"
              aria-checked={style.isClickable !== false}
              aria-label="Toggle layer clickability"
            >
              <span class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform {style.isClickable !== false ? 'translate-x-4' : ''}"></span>
            </button>
          </div>

          <!-- highlightColor picker -->
          <div class="space-y-1">
            <span class="text-xs text-on-surface-variant">Highlight color</span>
            <div class="flex items-center gap-2">
              <input
                type="color"
                value={style.highlightColor ?? '#ff6600'}
                oninput={(e) => updateStyleField('highlightColor', (e.target as HTMLInputElement).value)}
                class="h-7 w-8 rounded cursor-pointer border-0 bg-transparent p-0"
                aria-label="Selection highlight color"
              />
              {#if style.highlightColor}
                <span class="text-xs text-on-surface-variant font-mono">{style.highlightColor}</span>
                <button
                  onclick={() => updateStyleField('highlightColor', undefined)}
                  class="text-xs text-on-surface-variant/70 hover:text-white"
                  aria-label="Clear highlight color"
                >clear</button>
              {:else}
                <span class="text-xs text-on-surface-variant/70">Not set</span>
              {/if}
            </div>
          </div>

          <!-- isSandwiched toggle (polygon/mixed layers only) -->
          {#if layer.type === 'polygon' || layer.type === 'mixed'}
            <div class="flex items-center justify-between">
              <span class="text-xs text-on-surface-variant">Sandwiched</span>
              <button
                type="button"
                onclick={() => updateStyleField('isSandwiched', style.isSandwiched ? undefined : true)}
                class="relative h-5 w-9 rounded-full transition-colors {style.isSandwiched ? 'bg-primary-container' : 'bg-surface-high'}"
                role="switch"
                aria-checked={style.isSandwiched ?? false}
                aria-label="Place fill below basemap labels"
              >
                <span class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white transition-transform {style.isSandwiched ? 'translate-x-4' : ''}"></span>
              </button>
            </div>
          {/if}
        </div>
      {/if}

      <!-- ── Popup config ──────────────────────────────────────────────────── -->
      {#if allProperties.length > 0}
        <div class="border-t border-white/5 pt-3 space-y-3">
          <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Popup</span>

          <div class="space-y-1">
            <label class="text-xs text-on-surface-variant" for="fsl-popup-title">Title attribute</label>
            <select
              id="fsl-popup-title"
              value={style.popup?.titleAttribute ?? ''}
              onchange={(e) => updatePopup({ titleAttribute: (e.target as HTMLSelectElement).value || undefined })}
              class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Default (all properties)</option>
              {#each allProperties as prop (prop)}
                <option value={prop}>{prop}</option>
              {/each}
            </select>
          </div>

          <div class="space-y-1">
            <span class="text-xs text-on-surface-variant">Visible attributes</span>
            <div class="max-h-24 overflow-y-auto space-y-0.5">
              {#each allProperties as prop (prop)}
                <label class="flex items-center gap-1.5 text-xs text-on-surface cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!style.popup?.keyAttributes || style.popup.keyAttributes.includes(prop)}
                    onchange={(e) => {
                      const checked = (e.target as HTMLInputElement).checked;
                      const current = style.popup?.keyAttributes ?? [...allProperties];
                      const next = checked
                        ? [...current, prop]
                        : current.filter((k: string) => k !== prop);
                      updatePopup({ keyAttributes: next.length < allProperties.length ? next : undefined });
                    }}
                    class="rounded accent-primary"
                  />
                  {prop}
                </label>
              {/each}
            </div>
          </div>
        </div>
      {/if}

      <!-- ── Attribute display overrides ────────────────────────────────────── -->
      {#if allProperties.length > 0}
        <div class="border-t border-white/5 pt-3 space-y-3">
          <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Column Labels</span>
          <div class="space-y-1.5 max-h-40 overflow-y-auto">
            {#each allProperties as prop (prop)}
              <div class="flex items-center gap-1">
                <span class="text-xs text-on-surface-variant/70 w-16 truncate shrink-0" title={prop}>{prop}</span>
                <input
                  type="text"
                  value={style.attributes?.[prop]?.displayName ?? ''}
                  placeholder={prop}
                  onchange={(e) => updateAttributes(prop, (e.target as HTMLInputElement).value)}
                  class="flex-1 min-w-0 rounded bg-surface-low border border-white/5 px-1.5 py-1 text-xs text-on-surface placeholder-on-surface-variant/50 focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <!-- ── Choropleth configurator ─────────────────────────────────────── -->
      {#if showChoropleth}
        <div class="border-t border-white/5 pt-3 space-y-3">
          <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Choropleth</span>

          <!-- Attribute selector -->
          <div class="space-y-1">
            <label class="text-xs text-on-surface-variant" for="choro-attr">Attribute</label>
            <select
              id="choro-attr"
              bind:value={choroplethAttr}
              class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {#each numericProperties as prop (prop)}
                <option value={prop}>{prop}</option>
              {/each}
            </select>
          </div>

          <!-- Color ramp picker -->
          <div class="space-y-1">
            <span class="text-xs text-on-surface-variant">Color ramp</span>
            <div class="grid grid-cols-3 gap-1">
              {#each COLOR_RAMP_NAMES as ramp (ramp)}
                {@const colors = getColorRamp(ramp, 6)}
                <button
                  type="button"
                  onclick={() => (choroplethRamp = ramp)}
                  title={ramp}
                  aria-label={ramp}
                  aria-pressed={choroplethRamp === ramp}
                  class="flex rounded overflow-hidden h-4 border-2 transition-colors {choroplethRamp === ramp ? 'border-primary' : 'border-transparent'}"
                >
                  {#each colors as c (c)}
                    <span class="flex-1 block" style="background:{c}"></span>
                  {/each}
                </button>
              {/each}
            </div>
          </div>

          <!-- Number of classes -->
          <div class="space-y-1">
            <div class="flex justify-between">
              <span class="text-xs text-on-surface-variant">Classes</span>
              <span class="text-xs text-on-surface">{choroplethClasses}</span>
            </div>
            <input
              type="range"
              min="2"
              max="9"
              step="1"
              bind:value={choroplethClasses}
              class="w-full accent-primary"
              aria-label="Number of choropleth classes"
            />
          </div>

          <!-- Classification method -->
          <div class="space-y-1">
            <label class="text-xs text-on-surface-variant" for="choro-method">Method</label>
            <select
              id="choro-method"
              bind:value={choroplethMethod}
              class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="quantile">Quantile</option>
              <option value="equal_interval">Equal Interval</option>
            </select>
          </div>

          <Button
            variant="primary"
            size="sm"
            class="w-full"
            onclick={applyChoropleth}
            loading={applyingChoropleth}
            disabled={!choroplethAttr}
          >
            Apply Choropleth
          </Button>
        </div>
      {/if}

      <!-- ── Heatmap configurator (point layers only) ───────────────────── -->
      {#if showHeatmap}
        <div class="border-t border-white/5 pt-3 space-y-3">
          <span class="text-[10px] font-bold text-primary uppercase tracking-widest">Heatmap</span>

          <!-- Weight attribute (optional) -->
          <div class="space-y-1">
            <label class="text-xs text-on-surface-variant" for="heat-weight">Weight attribute</label>
            <select
              id="heat-weight"
              bind:value={heatmapWeightAttr}
              class="w-full rounded bg-surface-low border border-white/5 px-2 py-1.5 text-xs text-on-surface focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Uniform (all equal)</option>
              {#each numericProperties as prop (prop)}
                <option value={prop}>{prop}</option>
              {/each}
            </select>
          </div>

          <!-- Radius -->
          <div class="space-y-1">
            <div class="flex justify-between">
              <span class="text-xs text-on-surface-variant">Radius (px)</span>
              <span class="text-xs text-on-surface">{heatmapRadius}</span>
            </div>
            <input
              type="range"
              min="1"
              max="200"
              step="1"
              bind:value={heatmapRadius}
              class="w-full accent-primary"
              aria-label="Heatmap kernel radius in pixels"
            />
          </div>

          <!-- Intensity -->
          <div class="space-y-1">
            <div class="flex justify-between">
              <span class="text-xs text-on-surface-variant">Intensity</span>
              <span class="text-xs text-on-surface">{heatmapIntensity.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              bind:value={heatmapIntensity}
              class="w-full accent-primary"
              aria-label="Heatmap intensity multiplier"
            />
          </div>

          <Button
            variant="primary"
            size="sm"
            class="w-full"
            onclick={applyHeatmap}
            loading={applyingHeatmap}
          >
            Apply Heatmap
          </Button>

          {#if style.type === 'heatmap'}
            <Button
              variant="secondary"
              size="sm"
              class="w-full"
              onclick={resetToSimple}
            >
              Reset to Simple
            </Button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Simple style save (opacity) -->
    {#if style.type === 'simple'}
      <div class="px-3 py-3 border-t border-white/5 flex gap-2">
        {#if dirty && lastSavedStyle}
          <Button variant="ghost" size="sm" class="flex-1" onclick={revertStyle} disabled={saving}>
            Revert
          </Button>
        {/if}
        <Button variant="primary" size="sm" class={dirty && lastSavedStyle ? 'flex-1' : 'w-full'} onclick={saveStyle} loading={saving}>
          Save Style
        </Button>
      </div>
    {/if}
  </aside>
{/if}
