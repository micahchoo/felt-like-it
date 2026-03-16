import type { Feature, FeatureCollection } from 'geojson';

let _hotFeatures = $state<Record<string, Feature[]>>({});

export const hotOverlay = {
  get features() {
    return _hotFeatures;
  },

  getCollection(layerId: string): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: _hotFeatures[layerId] ?? [],
    };
  },

  addHotFeature(layerId: string, feature: Feature) {
    const existing = _hotFeatures[layerId] ?? [];
    _hotFeatures = { ..._hotFeatures, [layerId]: [...existing, feature] };
  },

  removeHotFeature(layerId: string, featureId: string) {
    const existing = _hotFeatures[layerId];
    if (!existing) return;
    _hotFeatures = {
      ..._hotFeatures,
      [layerId]: existing.filter((f) => String(f.id) !== featureId),
    };
  },

  setSelectedHotFeature(layerId: string, feature: Feature) {
    const existing = (_hotFeatures[layerId] ?? []).filter(
      (f) => String(f.id) !== String(feature.id)
    );
    _hotFeatures = { ..._hotFeatures, [layerId]: [...existing, feature] };
  },

  clearHotFeatures(layerId?: string) {
    if (layerId !== undefined) {
      const { [layerId]: _, ...rest } = _hotFeatures;
      _hotFeatures = rest;
    } else {
      _hotFeatures = {};
    }
  },
};
