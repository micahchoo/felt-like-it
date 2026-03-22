import type { Layer, LayerStyle } from '@felt-like-it/shared-types';

let _layers = $state<Layer[]>([]);
let _activeLayerId = $state<string | null>(null);

export const layersStore = {
  get all() { return _layers; },
  get active() { return _layers.find((l) => l.id === _activeLayerId) ?? null; },
  get activeLayerId() { return _activeLayerId; },

  set(layers: Layer[]) {
    _layers = [...layers].sort((a, b) => a.zIndex - b.zIndex);
    // Auto-select the first layer if nothing is active yet
    if (!_activeLayerId && _layers.length > 0) {
      _activeLayerId = _layers[0]?.id ?? null;
    }
  },

  add(layer: Layer) {
    _layers = [..._layers, layer].sort((a, b) => a.zIndex - b.zIndex);
    _activeLayerId = layer.id;
  },

  update(id: string, patch: Partial<Layer>) {
    _layers = _layers.map((l) => (l.id === id ? { ...l, ...patch } : l));
  },

  remove(id: string) {
    _layers = _layers.filter((l) => l.id !== id);
    if (_activeLayerId === id) {
      _activeLayerId = _layers[0]?.id ?? null;
    }
  },

  toggle(id: string) {
    _layers = _layers.map((l) =>
      l.id === id ? { ...l, visible: !l.visible } : l
    );
  },

  setActive(id: string | null) {
    _activeLayerId = id;
  },

  updateStyle(id: string, style: LayerStyle) {
    _layers = _layers.map((l) => (l.id === id ? { ...l, style } : l));
  },

  reorder(fromIndex: number, toIndex: number) {
    const sorted = [..._layers];
    const [moved] = sorted.splice(fromIndex, 1);
    if (!moved) return;
    sorted.splice(toIndex, 0, moved);
    // Re-assign z-indices
    _layers = sorted.map((l, i) => ({ ...l, zIndex: i }));
  },

  /** Get IDs in current z-order for syncing with server */
  getOrderedIds(): string[] {
    return _layers.map((l) => l.id);
  },

  /** Get IDs + versions in current z-order for versioned reorder */
  getOrderedIdsWithVersions(): Array<{ id: string; version: number }> {
    return _layers.map((l) => ({ id: l.id, version: l.version ?? 1 }));
  },
};
