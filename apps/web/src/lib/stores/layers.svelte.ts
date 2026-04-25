import { getContext, setContext } from 'svelte';
import type { Layer, LayerStyle } from '@felt-like-it/shared-types';

const LAYERS_STORE_KEY = Symbol('store:layers');

export class LayersStore {
  layers = $state<Layer[]>([]);
  activeLayerId = $state<string | null>(null);

  get all(): Layer[] { return this.layers; }
  get active(): Layer | null {
    return this.layers.find((l) => l.id === this.activeLayerId) ?? null;
  }

  set(layers: Layer[]): void {
    this.layers = [...layers].sort((a, b) => a.zIndex - b.zIndex);
    // Auto-select the first layer if nothing is active yet
    if (!this.activeLayerId && this.layers.length > 0) {
      this.activeLayerId = this.layers[0]?.id ?? null;
    }
  }

  add(layer: Layer): void {
    this.layers = [...this.layers, layer].sort((a, b) => a.zIndex - b.zIndex);
    this.activeLayerId = layer.id;
  }

  update(id: string, patch: Partial<Layer>): void {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
  }

  remove(id: string): void {
    this.layers = this.layers.filter((l) => l.id !== id);
    if (this.activeLayerId === id) {
      this.activeLayerId = this.layers[0]?.id ?? null;
    }
  }

  toggle(id: string): void {
    this.layers = this.layers.map((l) =>
      l.id === id ? { ...l, visible: !l.visible } : l
    );
  }

  setActive(id: string | null): void {
    this.activeLayerId = id;
  }

  updateStyle(id: string, style: LayerStyle): void {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, style } : l));
  }

  reorder(fromIndex: number, toIndex: number): void {
    const sorted = [...this.layers];
    const [moved] = sorted.splice(fromIndex, 1);
    if (!moved) return;
    sorted.splice(toIndex, 0, moved);
    // Re-assign z-indices
    this.layers = sorted.map((l, i) => ({ ...l, zIndex: i }));
  }

  /** Get IDs in current z-order for syncing with server */
  getOrderedIds(): string[] {
    return this.layers.map((l) => l.id);
  }

  /** Get IDs + versions in current z-order for versioned reorder */
  getOrderedIdsWithVersions(): Array<{ id: string; version: number }> {
    return this.layers.map((l) => ({ id: l.id, version: l.version ?? 1 }));
  }
}

export function createLayersStore(): LayersStore {
  return new LayersStore();
}

export function setLayersStore(store: LayersStore): LayersStore {
  setContext(LAYERS_STORE_KEY, store);
  return store;
}

export function getLayersStore(): LayersStore {
  const store = getContext<LayersStore | undefined>(LAYERS_STORE_KEY);
  if (!store) {
    throw new Error('LayersStore not registered — did the root +layout.svelte call setLayersStore()?');
  }
  return store;
}
