import { describe, it, expect, beforeEach } from 'vitest';
import { LayersStore } from '../lib/stores/layers.svelte.js';
import type { Layer, LayerStyle } from '@felt-like-it/shared-types';

function makeLayer(id: string, zIndex = 0, overrides: Partial<Layer> = {}): Layer {
  return {
    id,
    mapId: 'map-1',
    name: `Layer ${id}`,
    type: 'point',
    style: { type: 'simple', paint: {}, legend: [] } as LayerStyle,
    visible: true,
    zIndex,
    sourceFileName: null,
    version: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('layersStore', () => {
  let layersStore: LayersStore;
  beforeEach(() => {
    layersStore = new LayersStore();
  });

  describe('initial state', () => {
    it('starts empty', () => {
      expect(layersStore.all).toHaveLength(0);
      expect(layersStore.active).toBeNull();
      expect(layersStore.activeLayerId).toBeNull();
    });
  });

  describe('set()', () => {
    it('replaces layer list', () => {
      const layers = [makeLayer('a'), makeLayer('b')];
      layersStore.set(layers);
      expect(layersStore.all).toHaveLength(2);
    });

    it('sorts by zIndex ascending', () => {
      layersStore.set([makeLayer('a', 2), makeLayer('b', 0), makeLayer('c', 1)]);
      const ids = layersStore.all.map((l) => l.id);
      expect(ids).toEqual(['b', 'c', 'a']);
    });

    it('replaces previous content', () => {
      layersStore.set([makeLayer('a'), makeLayer('b')]);
      layersStore.set([makeLayer('c')]);
      expect(layersStore.all).toHaveLength(1);
      expect(layersStore.all[0]?.id).toBe('c');
    });
  });

  describe('add()', () => {
    it('appends and sorts', () => {
      layersStore.add(makeLayer('a', 1));
      layersStore.add(makeLayer('b', 0));
      expect(layersStore.all.map((l) => l.id)).toEqual(['b', 'a']);
    });

    it('sets the new layer as active', () => {
      layersStore.add(makeLayer('a'));
      expect(layersStore.activeLayerId).toBe('a');
      layersStore.add(makeLayer('b'));
      expect(layersStore.activeLayerId).toBe('b');
    });
  });

  describe('update()', () => {
    it('patches a layer by id', () => {
      layersStore.set([makeLayer('a')]);
      layersStore.update('a', { name: 'Renamed' });
      expect(layersStore.all[0]?.name).toBe('Renamed');
    });

    it('leaves other layers unchanged', () => {
      layersStore.set([makeLayer('a'), makeLayer('b')]);
      layersStore.update('a', { name: 'Renamed' });
      expect(layersStore.all[1]?.name).toBe('Layer b');
    });
  });

  describe('remove()', () => {
    it('removes a layer by id', () => {
      layersStore.set([makeLayer('a'), makeLayer('b')]);
      layersStore.remove('a');
      expect(layersStore.all.map((l) => l.id)).toEqual(['b']);
    });

    it('clears active when removing active layer', () => {
      layersStore.set([makeLayer('a'), makeLayer('b')]);
      layersStore.setActive('a');
      layersStore.remove('a');
      // Active should fall back to first remaining layer
      expect(layersStore.activeLayerId).toBe('b');
    });

    it('keeps active unchanged when removing non-active layer', () => {
      layersStore.set([makeLayer('a'), makeLayer('b')]);
      layersStore.setActive('a');
      layersStore.remove('b');
      expect(layersStore.activeLayerId).toBe('a');
    });
  });

  describe('toggle()', () => {
    it('flips visibility on', () => {
      layersStore.set([makeLayer('a', 0, { visible: false })]);
      layersStore.toggle('a');
      expect(layersStore.all[0]?.visible).toBe(true);
    });

    it('flips visibility off', () => {
      layersStore.set([makeLayer('a', 0, { visible: true })]);
      layersStore.toggle('a');
      expect(layersStore.all[0]?.visible).toBe(false);
    });

    it('does not affect other layers', () => {
      layersStore.set([makeLayer('a'), makeLayer('b')]);
      layersStore.toggle('a');
      expect(layersStore.all[1]?.visible).toBe(true);
    });
  });

  describe('setActive()', () => {
    it('sets active layer', () => {
      layersStore.set([makeLayer('a'), makeLayer('b')]);
      layersStore.setActive('b');
      expect(layersStore.activeLayerId).toBe('b');
      expect(layersStore.active?.id).toBe('b');
    });

    it('accepts null', () => {
      layersStore.set([makeLayer('a')]);
      layersStore.setActive('a');
      layersStore.setActive(null);
      expect(layersStore.activeLayerId).toBeNull();
      expect(layersStore.active).toBeNull();
    });
  });

  describe('reorder()', () => {
    it('moves a layer and re-assigns z-indices', () => {
      layersStore.set([makeLayer('a', 0), makeLayer('b', 1), makeLayer('c', 2)]);
      // Move 'a' (index 0) to index 2
      layersStore.reorder(0, 2);
      const ids = layersStore.all.map((l) => l.id);
      expect(ids).toEqual(['b', 'c', 'a']);
      // z-indices reassigned
      const zIndices = layersStore.all.map((l) => l.zIndex);
      expect(zIndices).toEqual([0, 1, 2]);
    });

    it('is a no-op when from === to', () => {
      layersStore.set([makeLayer('a', 0), makeLayer('b', 1)]);
      layersStore.reorder(0, 0);
      expect(layersStore.all.map((l) => l.id)).toEqual(['a', 'b']);
    });
  });

  describe('getOrderedIds()', () => {
    it('returns ids sorted by zIndex', () => {
      layersStore.set([makeLayer('a', 2), makeLayer('b', 0), makeLayer('c', 1)]);
      expect(layersStore.getOrderedIds()).toEqual(['b', 'c', 'a']);
    });

    it('returns empty array when no layers', () => {
      expect(layersStore.getOrderedIds()).toEqual([]);
    });
  });
});
