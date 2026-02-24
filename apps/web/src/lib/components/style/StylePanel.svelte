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

  // ── Simple style controls ──────────────────────────────────────────────────

  let saving = $state(false);

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

  function updateColor(color: string) {
    if (!layer || !style) return;
    const key = layer.type === 'line'
      ? 'line-color'
      : layer.type === 'polygon'
      ? 'fill-color'
      : 'circle-color';

    const newStyle: LayerStyle = {
      ...style,
      paint: { ...(style.paint as Record<string, unknown>), [key]: color },
    };
    styleStore.setStyle(layer.id, newStyle);
    layersStore.updateStyle(layer.id, newStyle);
  }

  function updateOpacity(opacity: number) {
    if (!layer || !style) return;
    const key = layer.type === 'line'
      ? 'line-opacity'
      : layer.type === 'polygon'
      ? 'fill-opacity'
      : 'circle-opacity';

    const newStyle: LayerStyle = {
      ...style,
      paint: { ...(style.paint as Record<string, unknown>), [key]: opacity },
    };
    styleStore.setStyle(layer.id, newStyle);
    layersStore.updateStyle(layer.id, newStyle);
  }

  async function saveStyle() {
    if (!layer || !style) return;
    saving = true;
    try {
      await trpc.layers.update.mutate({ id: layer.id, style });
      toastStore.success('Style saved.');
    } catch {
      toastStore.error('Failed to save style.');
    } finally {
      saving = false;
    }
  }

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
      await trpc.layers.update.mutate({ id: layer.id, style: merged });
      styleStore.setStyle(layer.id, merged);
      layersStore.updateStyle(layer.id, merged);
      toastStore.success('Choropleth applied.');
    } catch {
      toastStore.error('Failed to apply choropleth.');
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
      await trpc.layers.update.mutate({ id: layer.id, style: newStyle });
      styleStore.setStyle(layer.id, newStyle);
      layersStore.updateStyle(layer.id, newStyle);
      toastStore.success('Heatmap applied.');
    } catch {
      toastStore.error('Failed to apply heatmap.');
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
      await trpc.layers.update.mutate({ id: layer.id, style: newStyle });
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
    class="w-56 shrink-0 flex flex-col bg-slate-800 border-l border-white/10"
    aria-label="Style panel"
  >
    <div class="flex items-center justify-between px-3 py-3 border-b border-white/10">
      <h2 class="text-sm font-semibold text-white">Style</h2>
      <button
        onclick={() => styleStore.setEditingLayer(null)}
        class="text-slate-400 hover:text-white transition-colors"
        aria-label="Close style panel"
      >✕</button>
    </div>

    <div class="flex-1 overflow-y-auto p-3 space-y-4">
      <p class="text-xs text-slate-400 truncate">{layer.name}</p>

      <!-- Color (simple styles only — hidden when numeric/categorical active) -->
      {#if style.type === 'simple'}
        <div class="space-y-1">
          <span class="text-xs font-medium text-slate-300">Color</span>
          <div class="flex items-center gap-2">
            <input
              type="color"
              value={getColor()}
              oninput={(e) => updateColor((e.target as HTMLInputElement).value)}
              class="h-8 w-10 rounded cursor-pointer border-0 bg-transparent p-0"
              aria-label="Layer color"
            />
            <span class="text-xs text-slate-400 font-mono">{getColor()}</span>
          </div>
        </div>
      {/if}

      <!-- Opacity -->
      <div class="space-y-1">
        <div class="flex justify-between">
          <span class="text-xs font-medium text-slate-300">Opacity</span>
          <span class="text-xs text-slate-400">{Math.round(getOpacity() * 100)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={getOpacity()}
          oninput={(e) => updateOpacity(parseFloat((e.target as HTMLInputElement).value))}
          class="w-full accent-blue-500"
          aria-label="Layer opacity"
        />
      </div>

      <!-- Style type badge -->
      <div class="space-y-1">
        <span class="text-xs font-medium text-slate-300">Style type</span>
        <span class="inline-block rounded-full bg-slate-700 px-2 py-0.5 text-xs text-slate-300 capitalize">
          {style.type}
        </span>
      </div>

      <!-- ── Choropleth configurator ─────────────────────────────────────── -->
      {#if showChoropleth}
        <div class="border-t border-white/10 pt-3 space-y-3">
          <span class="text-xs font-semibold text-slate-300 uppercase tracking-wide">Choropleth</span>

          <!-- Attribute selector -->
          <div class="space-y-1">
            <label class="text-xs text-slate-400" for="choro-attr">Attribute</label>
            <select
              id="choro-attr"
              bind:value={choroplethAttr}
              class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {#each numericProperties as prop (prop)}
                <option value={prop}>{prop}</option>
              {/each}
            </select>
          </div>

          <!-- Color ramp picker -->
          <div class="space-y-1">
            <span class="text-xs text-slate-400">Color ramp</span>
            <div class="grid grid-cols-3 gap-1">
              {#each COLOR_RAMP_NAMES as ramp (ramp)}
                {@const colors = getColorRamp(ramp, 6)}
                <button
                  type="button"
                  onclick={() => (choroplethRamp = ramp)}
                  title={ramp}
                  aria-label={ramp}
                  aria-pressed={choroplethRamp === ramp}
                  class="flex rounded overflow-hidden h-4 border-2 transition-colors {choroplethRamp === ramp ? 'border-blue-400' : 'border-transparent'}"
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
              <span class="text-xs text-slate-400">Classes</span>
              <span class="text-xs text-slate-300">{choroplethClasses}</span>
            </div>
            <input
              type="range"
              min="2"
              max="9"
              step="1"
              bind:value={choroplethClasses}
              class="w-full accent-blue-500"
              aria-label="Number of choropleth classes"
            />
          </div>

          <!-- Classification method -->
          <div class="space-y-1">
            <label class="text-xs text-slate-400" for="choro-method">Method</label>
            <select
              id="choro-method"
              bind:value={choroplethMethod}
              class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
        <div class="border-t border-white/10 pt-3 space-y-3">
          <span class="text-xs font-semibold text-slate-300 uppercase tracking-wide">Heatmap</span>

          <!-- Weight attribute (optional) -->
          <div class="space-y-1">
            <label class="text-xs text-slate-400" for="heat-weight">Weight attribute</label>
            <select
              id="heat-weight"
              bind:value={heatmapWeightAttr}
              class="w-full rounded bg-slate-700 border border-white/10 px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
              <span class="text-xs text-slate-400">Radius (px)</span>
              <span class="text-xs text-slate-300">{heatmapRadius}</span>
            </div>
            <input
              type="range"
              min="1"
              max="200"
              step="1"
              bind:value={heatmapRadius}
              class="w-full accent-blue-500"
              aria-label="Heatmap kernel radius in pixels"
            />
          </div>

          <!-- Intensity -->
          <div class="space-y-1">
            <div class="flex justify-between">
              <span class="text-xs text-slate-400">Intensity</span>
              <span class="text-xs text-slate-300">{heatmapIntensity.toFixed(1)}</span>
            </div>
            <input
              type="range"
              min="0.1"
              max="5"
              step="0.1"
              bind:value={heatmapIntensity}
              class="w-full accent-blue-500"
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
      <div class="px-3 py-3 border-t border-white/10">
        <Button variant="primary" size="sm" class="w-full" onclick={saveStyle} loading={saving}>
          Save Style
        </Button>
      </div>
    {/if}
  </aside>
{/if}
