import { getContext, setContext } from 'svelte';
import type { Feature, FeatureCollection } from 'geojson';

const HOT_OVERLAY_KEY = Symbol('store:hotOverlay');

/**
 * Per-request hot overlay store — tracks features that have been mutated
 * locally and need to render before the server-side query refresh lands.
 */
export class HotOverlayStore {
  features = $state<Record<string, Feature[]>>({});

  getCollection(layerId: string): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: this.features[layerId] ?? [],
    };
  }

  addHotFeature(layerId: string, feature: Feature): void {
    const existing = this.features[layerId] ?? [];
    this.features = { ...this.features, [layerId]: [...existing, feature] };
  }

  removeHotFeature(layerId: string, featureId: string): void {
    const existing = this.features[layerId];
    if (!existing) return;
    this.features = {
      ...this.features,
      [layerId]: existing.filter((f) => String(f.id) !== featureId),
    };
  }

  setSelectedHotFeature(layerId: string, feature: Feature): void {
    const existing = (this.features[layerId] ?? []).filter(
      (f) => String(f.id) !== String(feature.id)
    );
    this.features = { ...this.features, [layerId]: [...existing, feature] };
  }

  clearHotFeatures(layerId?: string): void {
    if (layerId !== undefined) {
      const { [layerId]: _, ...rest } = this.features;
      this.features = rest;
    } else {
      this.features = {};
    }
  }
}

export function createHotOverlayStore(): HotOverlayStore {
  return new HotOverlayStore();
}

export function setHotOverlayStore(store: HotOverlayStore): HotOverlayStore {
  setContext(HOT_OVERLAY_KEY, store);
  return store;
}

export function getHotOverlayStore(): HotOverlayStore {
  const store = getContext<HotOverlayStore | undefined>(HOT_OVERLAY_KEY);
  if (!store) {
    throw new Error(
      'HotOverlayStore not registered — did the root +layout.svelte call setHotOverlayStore()?'
    );
  }
  return store;
}
