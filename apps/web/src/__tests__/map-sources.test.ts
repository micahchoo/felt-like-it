// @vitest-environment node
import { describe, test, expect, beforeEach } from 'vitest';
import { hotOverlay } from '$lib/utils/map-sources.svelte.js';

describe('hotOverlay', () => {
  beforeEach(() => {
    hotOverlay.clearHotFeatures();
  });

  const makeFeature = (id: string, coords: [number, number] = [0, 0]) => ({
    type: 'Feature' as const,
    id,
    geometry: { type: 'Point' as const, coordinates: coords },
    properties: {},
  });

  describe('addHotFeature', () => {
    test('adds feature to empty layer', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      const coll = hotOverlay.getCollection('layer-1');
      expect(coll.type).toBe('FeatureCollection');
      expect(coll.features).toHaveLength(1);
      expect(coll.features[0]?.id).toBe('f1');
    });

    test('appends to existing layer features', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.addHotFeature('layer-1', makeFeature('f2'));
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(2);
    });

    test('keeps layers independent', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.addHotFeature('layer-2', makeFeature('f2'));
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(1);
      expect(hotOverlay.getCollection('layer-2').features).toHaveLength(1);
    });
  });

  describe('removeHotFeature', () => {
    test('removes feature by id', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.addHotFeature('layer-1', makeFeature('f2'));
      hotOverlay.removeHotFeature('layer-1', 'f1');
      const coll = hotOverlay.getCollection('layer-1');
      expect(coll.features).toHaveLength(1);
      expect(coll.features[0]?.id).toBe('f2');
    });

    test('no-op when feature not found', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.removeHotFeature('layer-1', 'nonexistent');
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(1);
    });

    test('no-op when layer not found', () => {
      hotOverlay.removeHotFeature('nonexistent', 'f1');
      expect(hotOverlay.getCollection('nonexistent').features).toHaveLength(0);
    });
  });

  describe('setSelectedHotFeature', () => {
    test('adds new feature if not present', () => {
      hotOverlay.setSelectedHotFeature('layer-1', makeFeature('f1'));
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(1);
    });

    test('replaces existing feature with same id', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1', [0, 0]));
      hotOverlay.setSelectedHotFeature('layer-1', makeFeature('f1', [1, 1]));
      const coll = hotOverlay.getCollection('layer-1');
      expect(coll.features).toHaveLength(1);
      expect((coll.features[0]?.geometry as { coordinates: number[] }).coordinates).toEqual([1, 1]);
    });
  });

  describe('clearHotFeatures', () => {
    test('clears specific layer', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.addHotFeature('layer-2', makeFeature('f2'));
      hotOverlay.clearHotFeatures('layer-1');
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(0);
      expect(hotOverlay.getCollection('layer-2').features).toHaveLength(1);
    });

    test('clears all layers when no arg', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.addHotFeature('layer-2', makeFeature('f2'));
      hotOverlay.clearHotFeatures();
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(0);
      expect(hotOverlay.getCollection('layer-2').features).toHaveLength(0);
    });
  });

  describe('getCollection', () => {
    test('returns empty FeatureCollection for unknown layer', () => {
      const coll = hotOverlay.getCollection('nonexistent');
      expect(coll).toEqual({ type: 'FeatureCollection', features: [] });
    });
  });

  test('adversarial: rapid add/remove/clear cycle', () => {
    for (let i = 0; i < 100; i++) {
      hotOverlay.addHotFeature('layer-1', makeFeature(`f${i}`));
    }
    for (let i = 0; i < 50; i++) {
      hotOverlay.removeHotFeature('layer-1', `f${i}`);
    }
    expect(hotOverlay.getCollection('layer-1').features).toHaveLength(50);
    hotOverlay.clearHotFeatures('layer-1');
    expect(hotOverlay.getCollection('layer-1').features).toHaveLength(0);
  });
});
