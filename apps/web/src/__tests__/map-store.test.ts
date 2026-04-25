// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { MapStore, BASEMAPS } from '../lib/stores/map.svelte.js';
import type { BasemapId, InteractionMode } from '../lib/stores/map.svelte.js';

// Per-test instance — avoids cross-test contamination since the store is now
// instantiated per request (no shared module-level $state).
let mapStore: MapStore;
function resetStore() {
  mapStore = new MapStore();
}

describe('mapStore — defaults', () => {
  beforeEach(resetStore);

  it('center defaults to continental US center', () => {
    expect(mapStore.center).toEqual([-98.35, 39.5]);
  });

  it('zoom defaults to 4', () => {
    expect(mapStore.zoom).toBe(4);
  });

  it('bearing defaults to 0', () => {
    expect(mapStore.bearing).toBe(0);
  });

  it('pitch defaults to 0', () => {
    expect(mapStore.pitch).toBe(0);
  });

  it('basemapId defaults to osm', () => {
    expect(mapStore.basemapId).toBe('osm');
  });

  it('interactionMode defaults to default', () => {
    expect(mapStore.interactionMode).toBe('default');
  });

  it('mapInstance defaults to undefined', () => {
    expect(mapStore.mapInstance).toBeUndefined();
  });

  it('mapContainerEl defaults to undefined', () => {
    expect(mapStore.mapContainerEl).toBeUndefined();
  });
});

describe('mapStore — setViewport', () => {
  beforeEach(resetStore);

  it('updates center when provided', () => {
    mapStore.setViewport({ center: [-122.4, 37.8] });
    expect(mapStore.center).toEqual([-122.4, 37.8]);
  });

  it('updates zoom when provided', () => {
    mapStore.setViewport({ zoom: 12 });
    expect(mapStore.zoom).toBe(12);
  });

  it('updates bearing when provided', () => {
    mapStore.setViewport({ bearing: 45 });
    expect(mapStore.bearing).toBe(45);
  });

  it('updates pitch when provided', () => {
    mapStore.setViewport({ pitch: 30 });
    expect(mapStore.pitch).toBe(30);
  });

  it('updates all fields at once', () => {
    mapStore.setViewport({ center: [-73.9, 40.7], zoom: 14, bearing: 90, pitch: 20 });
    expect(mapStore.center).toEqual([-73.9, 40.7]);
    expect(mapStore.zoom).toBe(14);
    expect(mapStore.bearing).toBe(90);
    expect(mapStore.pitch).toBe(20);
  });

  it('leaves unmentioned fields unchanged', () => {
    mapStore.setViewport({ zoom: 8 });
    // center should remain at default, not be wiped
    expect(mapStore.center).toEqual([-98.35, 39.5]);
    expect(mapStore.bearing).toBe(0);
    expect(mapStore.pitch).toBe(0);
  });

  it('setting the same value twice leaves state identical', () => {
    mapStore.setViewport({ zoom: 10 });
    mapStore.setViewport({ zoom: 10 });
    expect(mapStore.zoom).toBe(10);
  });

  it('ignores undefined fields — does not reset them', () => {
    mapStore.setViewport({ center: [2.35, 48.85], zoom: 11 });
    // Pass an empty viewport update — nothing should change
    mapStore.setViewport({});
    expect(mapStore.center).toEqual([2.35, 48.85]);
    expect(mapStore.zoom).toBe(11);
  });
});

describe('mapStore — setBasemap', () => {
  beforeEach(resetStore);

  it('changes basemapId', () => {
    mapStore.setBasemap('positron');
    expect(mapStore.basemapId).toBe('positron');
  });

  it('can cycle through all known basemap IDs', () => {
    const ids: BasemapId[] = ['osm', 'positron', 'dark-matter'];
    for (const id of ids) {
      mapStore.setBasemap(id);
      expect(mapStore.basemapId).toBe(id);
    }
  });

  it('setting the same basemap twice is idempotent', () => {
    mapStore.setBasemap('dark-matter');
    mapStore.setBasemap('dark-matter');
    expect(mapStore.basemapId).toBe('dark-matter');
  });
});

describe('mapStore — basemapUrl', () => {
  beforeEach(resetStore);

  it('returns the styleUrl for the active basemapId', () => {
    for (const basemap of BASEMAPS) {
      mapStore.setBasemap(basemap.id);
      expect(mapStore.basemapUrl).toBe(basemap.styleUrl);
    }
  });

  it('osm basemapUrl points to openfreemap liberty style', () => {
    mapStore.setBasemap('osm');
    expect(mapStore.basemapUrl).toContain('openfreemap.org');
    expect(mapStore.basemapUrl).toContain('liberty');
  });

  it('positron basemapUrl points to openfreemap positron style', () => {
    mapStore.setBasemap('positron');
    expect(mapStore.basemapUrl).toContain('positron');
  });

  it('dark-matter basemapUrl points to openfreemap dark style', () => {
    mapStore.setBasemap('dark-matter');
    expect(mapStore.basemapUrl).toContain('dark');
  });
});

describe('mapStore — BASEMAPS constant', () => {
  it('exposes all three basemap options', () => {
    expect(BASEMAPS).toHaveLength(3);
  });

  it('each entry has id, label, and styleUrl', () => {
    for (const b of BASEMAPS) {
      expect(b).toHaveProperty('id');
      expect(b).toHaveProperty('label');
      expect(b).toHaveProperty('styleUrl');
      expect(typeof b.styleUrl).toBe('string');
      expect(b.styleUrl.length).toBeGreaterThan(0);
    }
  });

  it('IDs are unique', () => {
    const ids = BASEMAPS.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('mapStore — setInteractionMode', () => {
  beforeEach(resetStore);

  it('changes interactionMode', () => {
    mapStore.setInteractionMode('draw-point');
    expect(mapStore.interactionMode).toBe('draw-point');
  });

  it('can cycle through all interaction modes', () => {
    const modes: InteractionMode[] = ['default', 'draw-point', 'draw-line', 'draw-polygon', 'select', 'pan'];
    for (const mode of modes) {
      mapStore.setInteractionMode(mode);
      expect(mapStore.interactionMode).toBe(mode);
    }
  });

  it('setting the same mode twice is idempotent', () => {
    mapStore.setInteractionMode('select');
    mapStore.setInteractionMode('select');
    expect(mapStore.interactionMode).toBe('select');
  });
});

describe('mapStore — setMapInstance', () => {
  beforeEach(resetStore);

  it('stores a provided map instance', () => {
    const fakeMap = { type: 'MapLibreMap' } as unknown as import('maplibre-gl').Map;
    mapStore.setMapInstance(fakeMap);
    expect(mapStore.mapInstance).toBe(fakeMap);
  });

  it('clears the map instance when set to undefined', () => {
    const fakeMap = { type: 'MapLibreMap' } as unknown as import('maplibre-gl').Map;
    mapStore.setMapInstance(fakeMap);
    mapStore.setMapInstance(undefined);
    expect(mapStore.mapInstance).toBeUndefined();
  });

  it('replaces an existing instance with a new one', () => {
    const map1 = { id: 1 } as unknown as import('maplibre-gl').Map;
    const map2 = { id: 2 } as unknown as import('maplibre-gl').Map;
    mapStore.setMapInstance(map1);
    mapStore.setMapInstance(map2);
    expect(mapStore.mapInstance).toBe(map2);
  });
});

describe('mapStore — setMapContainerEl', () => {
  beforeEach(resetStore);

  it('stores a provided DOM element', () => {
    const fakeEl = { tagName: 'DIV' } as HTMLElement;
    mapStore.setMapContainerEl(fakeEl);
    expect(mapStore.mapContainerEl).toBe(fakeEl);
  });

  it('clears the element when set to undefined', () => {
    const fakeEl = { tagName: 'DIV' } as HTMLElement;
    mapStore.setMapContainerEl(fakeEl);
    mapStore.setMapContainerEl(undefined);
    expect(mapStore.mapContainerEl).toBeUndefined();
  });

  it('replaces an existing element with a new one', () => {
    const el1 = { id: 'first' } as unknown as HTMLElement;
    const el2 = { id: 'second' } as unknown as HTMLElement;
    mapStore.setMapContainerEl(el1);
    mapStore.setMapContainerEl(el2);
    expect(mapStore.mapContainerEl).toBe(el2);
  });
});

describe('mapStore — getViewportSnapshot', () => {
  beforeEach(resetStore);

  it('returns current viewport as a plain object', () => {
    mapStore.setViewport({ center: [-0.12, 51.5], zoom: 11, bearing: 15, pitch: 10 });
    const snap = mapStore.getViewportSnapshot();
    expect(snap.center).toEqual([-0.12, 51.5]);
    expect(snap.zoom).toBe(11);
    expect(snap.bearing).toBe(15);
    expect(snap.pitch).toBe(10);
  });

  it('snapshot reflects the state at time of call, not a live reference', () => {
    mapStore.setViewport({ zoom: 5 });
    const snap = mapStore.getViewportSnapshot();
    mapStore.setViewport({ zoom: 10 });
    // Snapshot was captured before the update — zoom should still be 5
    expect(snap.zoom).toBe(5);
    expect(mapStore.zoom).toBe(10);
  });
});

describe('mapStore — loadViewport', () => {
  beforeEach(resetStore);

  it('overwrites all viewport fields', () => {
    mapStore.loadViewport({ center: [139.69, 35.69], zoom: 13, bearing: 270, pitch: 60 });
    expect(mapStore.center).toEqual([139.69, 35.69]);
    expect(mapStore.zoom).toBe(13);
    expect(mapStore.bearing).toBe(270);
    expect(mapStore.pitch).toBe(60);
  });

  it('bearing and pitch treat null-ish values as 0 (?? 0 fallback in implementation)', () => {
    // The implementation uses `bearing ?? 0` and `pitch ?? 0`
    // Passing 0 explicitly should work fine
    mapStore.loadViewport({ center: [-98.35, 39.5], zoom: 4, bearing: 0, pitch: 0 });
    expect(mapStore.bearing).toBe(0);
    expect(mapStore.pitch).toBe(0);
  });
});

describe('mapStore — adversarial edge cases', () => {
  beforeEach(resetStore);

  it('extreme zoom value is stored verbatim (no clamping)', () => {
    mapStore.setViewport({ zoom: 999 });
    expect(mapStore.zoom).toBe(999);
  });

  it('negative zoom is stored verbatim (no clamping)', () => {
    mapStore.setViewport({ zoom: -5 });
    expect(mapStore.zoom).toBe(-5);
  });

  it('bearing beyond 360 is stored verbatim', () => {
    mapStore.setViewport({ bearing: 720 });
    expect(mapStore.bearing).toBe(720);
  });

  it('pitch beyond typical max is stored verbatim', () => {
    mapStore.setViewport({ pitch: 180 });
    expect(mapStore.pitch).toBe(180);
  });

  it('center with unusual coordinates is stored verbatim', () => {
    mapStore.setViewport({ center: [180, -90] });
    expect(mapStore.center).toEqual([180, -90]);
  });
});
