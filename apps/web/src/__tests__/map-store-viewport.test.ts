import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MapStore } from '../lib/stores/map.svelte.js';

const MAP_ID = 'test-map-uuid-1234';
const STORAGE_KEY = `felt-viewport-${MAP_ID}`;

let mapStore: MapStore;

describe('mapStore — localStorage viewport persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    mapStore = new MapStore();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('saveViewportLocally', () => {
    it('writes viewport to localStorage under the correct key', () => {
      mapStore.loadViewport({ center: [-122.4, 37.8], zoom: 12, bearing: 30, pitch: 45 });
      mapStore.saveViewportLocally(MAP_ID);

      const raw = localStorage.getItem(STORAGE_KEY);
      expect(raw).not.toBeNull();
      const parsed = JSON.parse(raw!);
      expect(parsed.center).toEqual([-122.4, 37.8]);
      expect(parsed.zoom).toBe(12);
      expect(parsed.bearing).toBe(30);
      expect(parsed.pitch).toBe(45);
    });

    it('scopes storage by map ID — different maps are independent', () => {
      const OTHER_ID = 'other-map-uuid-5678';
      mapStore.loadViewport({ center: [-122.4, 37.8], zoom: 12, bearing: 0, pitch: 0 });
      mapStore.saveViewportLocally(MAP_ID);

      mapStore.loadViewport({ center: [2.35, 48.85], zoom: 10, bearing: 0, pitch: 0 });
      mapStore.saveViewportLocally(OTHER_ID);

      const vp1 = JSON.parse(localStorage.getItem(`felt-viewport-${MAP_ID}`)!);
      const vp2 = JSON.parse(localStorage.getItem(`felt-viewport-${OTHER_ID}`)!);

      expect(vp1.center).toEqual([-122.4, 37.8]);
      expect(vp2.center).toEqual([2.35, 48.85]);
    });

    it('silently succeeds even when localStorage throws (quota exceeded)', () => {
      const original = localStorage.setItem.bind(localStorage);
      Object.defineProperty(localStorage, 'setItem', {
        value: () => { throw new Error('QuotaExceededError'); },
        writable: true,
        configurable: true,
      });

      expect(() => mapStore.saveViewportLocally(MAP_ID)).not.toThrow();

      Object.defineProperty(localStorage, 'setItem', {
        value: original,
        writable: true,
        configurable: true,
      });
    });
  });

  describe('loadViewportLocally', () => {
    it('returns null when no entry exists', () => {
      expect(mapStore.loadViewportLocally(MAP_ID)).toBeNull();
    });

    it('returns the stored viewport after save', () => {
      mapStore.loadViewport({ center: [-73.9, 40.7], zoom: 14, bearing: 90, pitch: 20 });
      mapStore.saveViewportLocally(MAP_ID);

      const loaded = mapStore.loadViewportLocally(MAP_ID);
      expect(loaded).not.toBeNull();
      expect(loaded!.center).toEqual([-73.9, 40.7]);
      expect(loaded!.zoom).toBe(14);
      expect(loaded!.bearing).toBe(90);
      expect(loaded!.pitch).toBe(20);
    });

    it('returns null for corrupt JSON', () => {
      localStorage.setItem(STORAGE_KEY, 'not-valid-json{{{');
      expect(mapStore.loadViewportLocally(MAP_ID)).toBeNull();
    });

    it('returns null for JSON missing required fields (malformed shape)', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ center: [-73.9, 40.7] }));
      expect(mapStore.loadViewportLocally(MAP_ID)).toBeNull();
    });

    it('returns null when center is not a 2-element array', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ center: 'invalid', zoom: 10, bearing: 0, pitch: 0 }));
      expect(mapStore.loadViewportLocally(MAP_ID)).toBeNull();
    });

    it('returns null for empty string stored', () => {
      localStorage.setItem(STORAGE_KEY, '');
      // JSON.parse('') throws — must be handled gracefully
      expect(mapStore.loadViewportLocally(MAP_ID)).toBeNull();
    });
  });

  describe('round-trip contract', () => {
    it('loadViewport(loadViewportLocally()) restores the saved position', () => {
      const saved = { center: [-0.12, 51.5] as [number, number], zoom: 11, bearing: 15, pitch: 10 };
      mapStore.loadViewport(saved);
      mapStore.saveViewportLocally(MAP_ID);

      // Simulate navigation: reset to default
      mapStore.loadViewport({ center: [-98.35, 39.5], zoom: 4, bearing: 0, pitch: 0 });

      // Restore
      const local = mapStore.loadViewportLocally(MAP_ID);
      expect(local).not.toBeNull();
      mapStore.loadViewport(local!);

      expect(mapStore.center).toEqual(saved.center);
      expect(mapStore.zoom).toBe(saved.zoom);
      expect(mapStore.bearing).toBe(saved.bearing);
      expect(mapStore.pitch).toBe(saved.pitch);
    });
  });
});
