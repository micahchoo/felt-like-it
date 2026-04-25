import { getContext, setContext } from 'svelte';
import type { LayerStyle } from '@felt-like-it/shared-types';

const STYLE_STORE_KEY = Symbol('store:style');

export class StyleStore {
  // Style overrides: layerId → style
  styleOverrides = $state<Map<string, LayerStyle>>(new Map());
  showLegend = $state(true);
  editingLayerId = $state<string | null>(null);

  getStyle(layerId: string): LayerStyle | null {
    return this.styleOverrides.get(layerId) ?? null;
  }

  setStyle(layerId: string, style: LayerStyle): void {
    const next = new Map(this.styleOverrides);
    next.set(layerId, style);
    this.styleOverrides = next;
  }

  clearStyle(layerId: string): void {
    const next = new Map(this.styleOverrides);
    next.delete(layerId);
    this.styleOverrides = next;
  }

  toggleLegend(): void {
    this.showLegend = !this.showLegend;
  }

  setEditingLayer(layerId: string | null): void {
    this.editingLayerId = layerId;
  }
}

export function createStyleStore(): StyleStore {
  return new StyleStore();
}

export function setStyleStore(store: StyleStore): StyleStore {
  setContext(STYLE_STORE_KEY, store);
  return store;
}

export function getStyleStore(): StyleStore {
  const store = getContext<StyleStore | undefined>(STYLE_STORE_KEY);
  if (!store) {
    throw new Error('StyleStore not registered — did the root +layout.svelte call setStyleStore()?');
  }
  return store;
}
