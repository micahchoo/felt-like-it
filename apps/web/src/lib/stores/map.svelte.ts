import { getContext, setContext } from 'svelte';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { mutation } from '$lib/debug/effect-tracker.js';

export type InteractionMode = 'default' | 'draw-point' | 'draw-line' | 'draw-polygon' | 'select' | 'pan';

export type BasemapId = 'osm' | 'positron' | 'dark-matter';

export interface BasemapOption {
  id: BasemapId;
  label: string;
  styleUrl: string;
}

export const BASEMAPS: BasemapOption[] = [
  {
    id: 'osm',
    label: 'OpenStreetMap',
    styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  },
  {
    id: 'positron',
    label: 'Positron (Light)',
    styleUrl: 'https://tiles.openfreemap.org/styles/positron',
  },
  {
    id: 'dark-matter',
    label: 'Dark Matter',
    styleUrl: 'https://tiles.openfreemap.org/styles/dark',
  },
];

const MAP_STORE_KEY = Symbol('store:map');

/**
 * Per-request map viewport / basemap / mode store.
 *
 * NOTE on $state.raw fields:
 *   `mapInstance` (MapLibreMap) and `mapContainerEl` (HTMLElement) are wrapped in
 *   $state.raw because they are mutated externally (by MapLibre / the DOM) and
 *   are not safe to wrap in a $state Proxy — proxying would break MapLibre's
 *   internal mutation paths and html-to-image's structural reads.
 */
export class MapStore {
  // Map viewport state — declared first so any later getters/methods read from a
  // fully-initialised set of fields (audit: mx-0dc46f).
  center = $state<[number, number]>([-98.35, 39.5]);
  zoom = $state(4);
  bearing = $state(0);
  pitch = $state(0);
  basemapId = $state<BasemapId>('osm');
  interactionMode = $state<InteractionMode>('default');
  // MapLibre and DOM objects are proxy-unfriendly — use $state.raw.
  mapInstance = $state.raw<MapLibreMap | undefined>(undefined);
  /**
   * Viewport version counter — incremented ONLY by loadViewport().
   * Used by MapCanvas to distinguish external (programmatic) viewport changes
   * from map-driven changes flowing through setViewport(), preventing the
   * MC:localToStore ↔ MC:storeToLocal effect cycle during pan/zoom animations.
   */
  viewportVersion = $state(0);
  /**
   * The DOM element wrapping the map canvas + overlay controls (e.g. Legend).
   * Set by MapEditor.svelte so ExportDialog can capture the full visible map area
   * via html-to-image (preserveDrawingBuffer must be true on the MapLibre canvas).
   */
  mapContainerEl = $state.raw<HTMLElement | undefined>(undefined);

  get basemapUrl(): string {
    return BASEMAPS.find((b) => b.id === this.basemapId)?.styleUrl ?? BASEMAPS[0]?.styleUrl ?? '';
  }

  setViewport(viewport: {
    center?: [number, number];
    zoom?: number;
    bearing?: number;
    pitch?: number;
  }): void {
    // Guard each field with equality checks to prevent reactive churn.
    // Without these, the MapLibre center prop → moveend → setViewport → re-render
    // cycle creates an infinite loop (effect_update_depth_exceeded) because each
    // call assigns a new array/value even when coordinates are identical.
    let changed = false;
    if (viewport.center !== undefined &&
        (viewport.center[0] !== this.center[0] || viewport.center[1] !== this.center[1])) {
      this.center = viewport.center;
      changed = true;
    }
    if (viewport.zoom !== undefined && viewport.zoom !== this.zoom) { this.zoom = viewport.zoom; changed = true; }
    if (viewport.bearing !== undefined && viewport.bearing !== this.bearing) { this.bearing = viewport.bearing; changed = true; }
    if (viewport.pitch !== undefined && viewport.pitch !== this.pitch) { this.pitch = viewport.pitch; changed = true; }
    if (changed) mutation('mapStore', 'setViewport', { center: this.center, zoom: this.zoom });
  }

  setBasemap(id: BasemapId): void {
    this.basemapId = id;
  }

  setInteractionMode(mode: InteractionMode): void {
    this.interactionMode = mode;
  }

  setMapInstance(map: MapLibreMap | undefined): void {
    mutation('mapStore', 'setMapInstance', map ? 'MapLibreMap' : 'undefined');
    this.mapInstance = map;
  }

  setMapContainerEl(el: HTMLElement | undefined): void {
    this.mapContainerEl = el;
  }

  /** Sync from saved map viewport data (external/programmatic changes) */
  loadViewport(viewport: { center: [number, number]; zoom: number; bearing: number; pitch: number }): void {
    this.center = viewport.center;
    this.zoom = viewport.zoom;
    this.bearing = viewport.bearing ?? 0;
    this.pitch = viewport.pitch ?? 0;
    this.viewportVersion++;
  }

  /** Get current viewport as a plain object for saving */
  getViewportSnapshot(): { center: [number, number]; zoom: number; bearing: number; pitch: number } {
    return { center: this.center, zoom: this.zoom, bearing: this.bearing, pitch: this.pitch };
  }

  /**
   * Persist current viewport to localStorage, keyed by mapId.
   * Silently ignores storage errors (e.g. private browsing, quota exceeded).
   */
  saveViewportLocally(mapId: string): void {
    try {
      const vp = { center: this.center, zoom: this.zoom, bearing: this.bearing, pitch: this.pitch };
      localStorage.setItem(`felt-viewport-${mapId}`, JSON.stringify(vp));
    } catch { /* silently ignore storage errors */ }
  }

  /**
   * Restore viewport from localStorage for the given mapId.
   * Returns the stored viewport, or null if absent or corrupt.
   */
  loadViewportLocally(mapId: string): { center: [number, number]; zoom: number; bearing: number; pitch: number } | null {
    try {
      const raw = localStorage.getItem(`felt-viewport-${mapId}`);
      if (!raw) return null;
      const vp = JSON.parse(raw) as { center: [number, number]; zoom: number; bearing: number; pitch: number };
      // Basic shape validation
      if (
        Array.isArray(vp.center) && vp.center.length === 2 &&
        typeof vp.zoom === 'number' &&
        typeof vp.bearing === 'number' &&
        typeof vp.pitch === 'number'
      ) {
        return vp;
      }
      return null;
    } catch { /* silently ignore parse errors */ }
    return null;
  }
}

export function createMapStore(): MapStore {
  return new MapStore();
}

export function setMapStore(store: MapStore): MapStore {
  setContext(MAP_STORE_KEY, store);
  return store;
}

export function getMapStore(): MapStore {
  const store = getContext<MapStore | undefined>(MAP_STORE_KEY);
  if (!store) {
    throw new Error('MapStore not registered — did the root +layout.svelte call setMapStore()?');
  }
  return store;
}
