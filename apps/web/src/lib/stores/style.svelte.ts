import type { LayerStyle } from '@felt-like-it/shared-types';

// Style overrides: layerId → style
let _styleOverrides = $state<Map<string, LayerStyle>>(new Map());
let _showLegend = $state(true);
let _editingLayerId = $state<string | null>(null);

export const styleStore = {
  get showLegend() { return _showLegend; },
  get editingLayerId() { return _editingLayerId; },

  getStyle(layerId: string): LayerStyle | null {
    return _styleOverrides.get(layerId) ?? null;
  },

  setStyle(layerId: string, style: LayerStyle) {
    const next = new Map(_styleOverrides);
    next.set(layerId, style);
    _styleOverrides = next;
  },

  clearStyle(layerId: string) {
    const next = new Map(_styleOverrides);
    next.delete(layerId);
    _styleOverrides = next;
  },

  toggleLegend() {
    _showLegend = !_showLegend;
  },

  setEditingLayer(layerId: string | null) {
    _editingLayerId = layerId;
  },
};
