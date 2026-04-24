<script lang="ts">
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { styleStore } from '$lib/stores/style.svelte.js';
  import { getMapEditorState } from '$lib/stores/map-editor-state.svelte.js';
  import { trpc } from '$lib/utils/trpc.js';
  import { getErrorCode } from '$lib/utils/handle-error.js';
  import { toastStore } from '$lib/components/ui/Toast.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';

  interface Props {
    mapId: string;
    onlayerchange?: () => void;
  }

  let { mapId, onlayerchange }: Props = $props();
  let creatingLayer = $state(false);
  let newLayerName = $state('');
  let loadErrors: Record<string, string> = $state({});
  const togglingIds = new Set<string>();
  /** Per-layer busy flag for "convert features to annotations" — prevents double-click. */
  let convertingIds = $state<Record<string, boolean>>({});

  const editorState = getMapEditorState();

  async function convertFeaturesToAnnotations(layerId: string, layerName: string) {
    if (convertingIds[layerId]) return;
    convertingIds = { ...convertingIds, [layerId]: true };
    try {
      // Selection-driven default (unified-annotations.md rule 2): if the user
      // has features selected on this layer, only those convert. Falling back
      // to "all features" would flood the annotation panel on any layer with
      // >50 rows — the old default was a trap.
      const selectedIds = editorState.selectedLayerId === layerId
        ? Array.from(editorState.selectedFeatureIds)
        : [];

      let featureIds: string[];
      let scopeLabel: string;
      if (selectedIds.length > 0) {
        featureIds = selectedIds;
        scopeLabel = `${featureIds.length} selected`;
      } else {
        const fc = await trpc.features.list.query({ layerId });
        const all = fc.features.map((f) => f.id).filter((id): id is string => !!id);
        if (all.length === 0) {
          toastStore.info(`Layer "${layerName}" has no features to convert.`);
          return;
        }
        // Require an explicit yes when scope falls back to "all" — the large-N
        // case is the expensive one, so we make the user say so.
        if (!confirm(`No features selected. Convert ALL ${all.length} features in "${layerName}"? Tip: select features on the map or in the table to scope this.`)) return;
        featureIds = all;
        scopeLabel = `all ${featureIds.length}`;
      }

      if (featureIds.length > 500) {
        toastStore.error(`${featureIds.length} features; convert-to-annotations caps at 500 per call.`);
        return;
      }

      await trpc.annotations.convertLayerFeaturesToAnnotations.mutate({ mapId, layerId, featureIds });
      onlayerchange?.();
      toastStore.success(`${scopeLabel} annotations created from "${layerName}".`);
    } catch {
      toastStore.error('Failed to convert features to annotations.');
    } finally {
      convertingIds = { ...convertingIds, [layerId]: false };
    }
  }

  async function createLayer() {
    const name = newLayerName.trim() || 'New Layer';
    creatingLayer = true;
    try {
      const layer = await trpc.layers.create.mutate({ mapId, name });
      layersStore.add(layer);
      newLayerName = '';
      onlayerchange?.();
      toastStore.success(`Layer "${name}" created.`);
    } catch {
      toastStore.error('Failed to create layer.');
      // No optimistic add was made (add happens after await), so no rollback needed.
    } finally {
      creatingLayer = false;
    }
  }

  async function deleteLayer(layerId: string, layerName: string) {
    if (!confirm(`Delete layer "${layerName}" and all its features? This cannot be undone.`)) return;
    try {
      await trpc.layers.delete.mutate({ id: layerId });
      layersStore.remove(layerId);
      styleStore.clearStyle(layerId);
      onlayerchange?.();
      toastStore.info(`Layer "${layerName}" deleted.`);
    } catch {
      toastStore.error('Failed to delete layer.');
    }
  }

  async function toggleVisibility(layerId: string) {
    if (togglingIds.has(layerId)) return;
    const layer = layersStore.all.find((l) => l.id === layerId);
    if (!layer) return;
    togglingIds.add(layerId);
    layersStore.toggle(layerId);
    try {
      await trpc.layers.update.mutate({ id: layerId, visible: !layer.visible, version: layer.version });
    } catch (err: unknown) {
      // Revert optimistic update
      layersStore.toggle(layerId);
      const msg = getErrorCode(err) === 'CONFLICT'
        ? 'Modified by another user. Please reload.'
        : 'Failed to update visibility.';
      loadErrors = { ...loadErrors, [layerId]: msg };
      toastStore.error(msg);
    } finally {
      togglingIds.delete(layerId);
    }
  }

  async function moveLayer(index: number, direction: 'up' | 'down'): Promise<void> {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= layersStore.all.length) return;

    layersStore.reorder(index, targetIndex);

    try {
      await trpc.layers.reorder.mutate({
        mapId,
        order: layersStore.getOrderedIdsWithVersions(),
      });
    } catch (err: unknown) {
      const id = layersStore.all[targetIndex]?.id;
      const msg = getErrorCode(err) === 'CONFLICT'
        ? 'Order modified by another user. Please reload.'
        : 'Failed to reorder layers.';
      if (id) loadErrors = { ...loadErrors, [id]: msg };
      toastStore.error(msg);
    }
  }

  function clearError(layerId: string) {
    const { [layerId]: _, ...rest } = loadErrors;
    loadErrors = rest;
  }

  const LAYER_TYPE_ICONS: Record<string, string> = {
    point: '●',
    line: '╱',
    polygon: '⬠',
    mixed: '◈',
  };
</script>

<aside
  class="flex flex-col h-full bg-surface-container border-r border-surface-high"
  aria-label="Layers panel"
>
  <!-- Header -->
  <div class="px-3 py-3 border-b border-white/5">
    <h2 class="text-sm font-semibold font-display uppercase tracking-wide text-white">Layers</h2>
    <p class="text-[11px] text-on-surface-variant mt-1 leading-snug">
      Layers organize your map data. Each layer holds one type of geometry (points, lines, or polygons). Select a layer to draw on it or view its data.
    </p>
  </div>

  <!-- Layer list -->
  <div class="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-1" role="list">
    {#if layersStore.all.length === 0}
      <div class="p-4 text-center space-y-3">
        <p class="text-sm text-on-surface-variant">No layers yet. Layers organize your map data.</p>
        <div class="space-y-2">
          <Button size="sm" onclick={createLayer} class="w-full">
            Create empty layer
          </Button>
        </div>
        <p class="text-xs text-on-surface-variant mt-2">Tip: You can drag &amp; drop files onto the map to import them.</p>
      </div>
    {/if}

    {#each layersStore.all as layer, index (layer.id)}
      <div
        class="group flex items-center gap-2 rounded-md px-2 py-2 cursor-pointer transition-colors
               {layersStore.activeLayerId === layer.id
                 ? 'bg-primary-container/20 ring-1 ring-primary/50'
                 : 'hover:bg-surface-high/60'}"
        role="button"
        onclick={() => { clearError(layer.id); layersStore.setActive(layer.id); }}
        onkeydown={(e) => e.key === 'Enter' && layersStore.setActive(layer.id)}
        tabindex="0"
        aria-current={layersStore.activeLayerId === layer.id ? 'true' : undefined}
      >
        <!-- Type icon with layer color -->
        <span class="text-base w-5 text-center shrink-0 text-on-surface-variant">
          {LAYER_TYPE_ICONS[layer.type] ?? '◈'}
        </span>

        <!-- Layer name -->
        <span
          class="flex-1 text-sm truncate {layer.visible ? 'text-on-surface' : 'text-on-surface-variant'}"
          title={layer.name}
        >
          {layer.name}
        </span>

        <!-- Type badge -->
        <span class="text-[9px] font-display uppercase tracking-wider px-1.5 py-0.5 rounded shrink-0 {
          layer.type === 'point' ? 'bg-teal-500/20 text-teal-300' :
          layer.type === 'polygon' ? 'bg-blue-500/20 text-blue-300' :
          layer.type === 'line' ? 'bg-purple-500/20 text-purple-300' :
          'bg-amber-500/20 text-amber-300'
        }">{layer.type.toUpperCase()}</span>

        <!-- Actions -->
        <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <!-- Move up -->
          {#if index > 0}
            <Tooltip content="Move up" position="top">
              <button
                onclick={(e) => { e.stopPropagation(); moveLayer(index, 'up'); }}
                class="h-6 w-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-high transition-colors"
                aria-label="Move layer up"
              >
                <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M7.646 4.646a.5.5 0 01.708 0l3 3a.5.5 0 01-.708.708L8.5 6.207V12.5a.5.5 0 01-1 0V6.207L5.354 8.354a.5.5 0 11-.708-.708l3-3z"/>
                </svg>
              </button>
            </Tooltip>
          {/if}

          <!-- Move down -->
          {#if index < layersStore.all.length - 1}
            <Tooltip content="Move down" position="top">
              <button
                onclick={(e) => { e.stopPropagation(); moveLayer(index, 'down'); }}
                class="h-6 w-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-high transition-colors"
                aria-label="Move layer down"
              >
                <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M8.354 11.354a.5.5 0 01-.708 0l-3-3a.5.5 0 11.708-.708L7.5 9.793V3.5a.5.5 0 011 0v6.293l2.146-2.147a.5.5 0 01.708.708l-3 3z"/>
                </svg>
              </button>
            </Tooltip>
          {/if}

          <!-- Style editor -->
          <Tooltip content="Edit style" position="top">
            <button
              onclick={(e) => { e.stopPropagation(); styleStore.setEditingLayer(layer.id); }}
              class="h-6 w-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-high transition-colors"
              aria-label="Edit layer style"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.013 1.427a1.75 1.75 0 012.474 0l1.086 1.086a1.75 1.75 0 010 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 01-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm.176 4.823L9.75 4.81l-6.286 6.287a.25.25 0 00-.064.108l-.558 1.953 1.953-.558a.249.249 0 00.108-.064zm1.238-3.763a.25.25 0 00-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 000-.354z"/>
              </svg>
            </button>
          </Tooltip>

          <!-- Convert features to annotations (reverse direction of "Promote to layer") -->
          <Tooltip content="Convert selected features to annotations (or all if none selected)" position="top">
            <button
              onclick={(e) => { e.stopPropagation(); convertFeaturesToAnnotations(layer.id, layer.name); }}
              disabled={!!convertingIds[layer.id]}
              class="h-6 w-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-high transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Convert features to annotations"
            >
              <!-- Speech-bubble icon to suggest "add notes" -->
              <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M2.678 11.894a1 1 0 01.287.801 10.97 10.97 0 01-.398 2c1.395-.323 2.247-.697 2.634-.893a1 1 0 01.71-.074A8 8 0 008 14c3.996 0 7-2.807 7-6 0-3.192-3.004-6-7-6S1 4.808 1 8c0 1.468.617 2.83 1.678 3.894zm-.493 3.905a21.682 21.682 0 01-.713.129c-.2.032-.352-.176-.273-.362a9.68 9.68 0 00.244-.637l.003-.01c.248-.72.45-1.548.524-2.319C.743 11.37 0 9.76 0 8c0-3.866 3.582-7 8-7s8 3.134 8 7-3.582 7-8 7a9.06 9.06 0 01-2.347-.306c-.52.263-1.639.742-3.468 1.105z"/>
              </svg>
            </button>
          </Tooltip>

          <!-- Visibility toggle -->
          <Tooltip content={layer.visible ? 'Hide layer' : 'Show layer'} position="top">
            <button
              onclick={(e) => { e.stopPropagation(); toggleVisibility(layer.id); }}
              class="h-6 w-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-high transition-colors"
              aria-label={layer.visible ? 'Hide layer' : 'Show layer'}
              aria-pressed={!layer.visible}
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                {#if layer.visible}
                  <path d="M1.679 7.932c.412-.621 1.242-1.75 2.366-2.717C5.175 4.242 6.527 3.5 8 3.5c1.473 0 2.824.742 3.955 1.715 1.124.967 1.954 2.096 2.366 2.717a.119.119 0 010 .136c-.412.621-1.242 1.75-2.366 2.717C10.825 11.758 9.473 12.5 8 12.5c-1.473 0-2.824-.742-3.955-1.715C2.92 9.818 2.09 8.689 1.679 8.068a.119.119 0 010-.136zM8 2c-1.981 0-3.67.992-4.933 2.078C1.797 5.169.88 6.423.43 7.1a1.619 1.619 0 000 1.798c.45.678 1.367 1.932 2.637 3.024C4.329 13.008 6.019 14 8 14c1.981 0 3.67-.992 4.933-2.078 1.27-1.091 2.187-2.345 2.637-3.023a1.619 1.619 0 000-1.798c-.45-.678-1.367-1.932-2.637-3.023C11.671 2.992 9.981 2 8 2zm0 8a2 2 0 100-4 2 2 0 000 4z"/>
                {:else}
                  <path d="M.143 2.31a.75.75 0 011.047-.167l14.5 10.5a.75.75 0 11-.88 1.214l-2.248-1.628C11.346 13.19 9.792 14 8 14c-1.981 0-3.67-.992-4.933-2.078C1.797 10.83.88 9.577.43 8.9a1.619 1.619 0 010-1.798c.353-.533.995-1.433 1.914-2.334L.31 3.357A.75.75 0 01.143 2.31zm3.196 5.218c-.752.808-1.283 1.578-1.59 2.068a.12.12 0 000 .136c.412.622 1.243 1.75 2.366 2.717C5.175 13.258 6.527 14 8 14c1.045 0 2.05-.352 2.93-.924l-1.244-.9C9.325 12.349 8.683 12.5 8 12.5c-1.473 0-2.825-.742-3.956-1.715a10.897 10.897 0 01-1.339-1.44l.634-.817zM8 3.5c-.647 0-1.262.134-1.84.372l-1.26-.912C5.765 2.465 6.855 2 8 2c1.981 0 3.671.992 4.933 2.078 1.27 1.091 2.187 2.345 2.637 3.023a1.619 1.619 0 010 1.798 10.9 10.9 0 01-.616.877l-1.254-.908a10.9 10.9 0 00.598-.784.12.12 0 000-.136C13.758 7.243 12.928 6.115 11.805 5.148 10.674 4.175 9.322 3.5 8 3.5zM5.5 8a2.5 2.5 0 015 0 2.5 2.5 0 01-5 0z"/>
                {/if}
              </svg>
            </button>
          </Tooltip>

          <!-- Delete -->
          <Tooltip content="Delete layer" position="top">
            <button
              onclick={(e) => { e.stopPropagation(); deleteLayer(layer.id, layer.name); }}
              class="h-6 w-6 rounded flex items-center justify-center text-on-surface-variant hover:text-error hover:bg-surface-high transition-colors"
              aria-label="Delete layer"
            >
              <svg class="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11 1.75V3h2.25a.75.75 0 010 1.5H2.75a.75.75 0 010-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75zM4.496 6.675l.66 6.6a.25.25 0 00.249.225h5.19a.25.25 0 00.249-.225l.66-6.6a.75.75 0 011.492.149l-.66 6.6A1.748 1.748 0 0110.595 15H5.405a1.748 1.748 0 01-1.741-1.576l-.66-6.6a.75.75 0 111.492-.149z"/>
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
      {#if loadErrors[layer.id]}
        <p class="text-[11px] text-error px-2 pb-1">{loadErrors[layer.id]}</p>
      {/if}
    {/each}
  </div>

  <!-- Create layer -->
  <div class="px-2 py-2 border-t border-white/5">
    <form
      class="flex gap-1"
      onsubmit={(e) => { e.preventDefault(); createLayer(); }}
    >
      <input
        type="text"
        bind:value={newLayerName}
        placeholder="New layer name…"
        class="flex-1 min-w-0 rounded-md bg-surface-low border border-surface-high px-2 py-1.5 text-xs text-on-surface placeholder-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary"
      />
      <Button
        type="submit"
        variant="primary"
        size="sm"
        loading={creatingLayer}
        aria-label="Create layer"
        class="signature-gradient"
      >+</Button>
    </form>
  </div>
</aside>
