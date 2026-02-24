<script lang="ts">
  import { styleStore } from '$lib/stores/style.svelte.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { trpc } from '$lib/utils/trpc.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import type { LayerStyle } from '@felt-like-it/shared-types';


  const layer = $derived(
    styleStore.editingLayerId
      ? layersStore.all.find((l) => l.id === styleStore.editingLayerId)
      : null
  );

  const style = $derived(layer?.style as LayerStyle | null | undefined);

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

      <!-- Color -->
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
    </div>

    <div class="px-3 py-3 border-t border-white/10">
      <Button variant="primary" size="sm" class="w-full" onclick={saveStyle} loading={saving}>
        Save Style
      </Button>
    </div>
  </aside>
{/if}
