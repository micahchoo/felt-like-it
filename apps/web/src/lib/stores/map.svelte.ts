import type { Map as MapLibreMap } from 'maplibre-gl';

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

// Map viewport state
let _center = $state<[number, number]>([-98.35, 39.5]);
let _zoom = $state(4);
let _bearing = $state(0);
let _pitch = $state(0);
let _basemapId = $state<BasemapId>('osm');
let _interactionMode = $state<InteractionMode>('default');
let _mapInstance = $state<MapLibreMap | undefined>(undefined);
/**
 * The DOM element wrapping the map canvas + overlay controls (e.g. Legend).
 * Set by MapEditor.svelte so ExportDialog can capture the full visible map area
 * via html-to-image (preserveDrawingBuffer must be true on the MapLibre canvas).
 */
let _mapContainerEl = $state<HTMLElement | undefined>(undefined);

export const mapStore = {
  get center() { return _center; },
  get zoom() { return _zoom; },
  get bearing() { return _bearing; },
  get pitch() { return _pitch; },
  get basemapId() { return _basemapId; },
  get basemapUrl() {
    return BASEMAPS.find((b) => b.id === _basemapId)?.styleUrl ?? BASEMAPS[0]?.styleUrl ?? '';
  },
  get interactionMode() { return _interactionMode; },
  get mapInstance() { return _mapInstance; },
  get mapContainerEl() { return _mapContainerEl; },

  setViewport(viewport: {
    center?: [number, number];
    zoom?: number;
    bearing?: number;
    pitch?: number;
  }) {
    if (viewport.center !== undefined) _center = viewport.center;
    if (viewport.zoom !== undefined) _zoom = viewport.zoom;
    if (viewport.bearing !== undefined) _bearing = viewport.bearing;
    if (viewport.pitch !== undefined) _pitch = viewport.pitch;
  },

  setBasemap(id: BasemapId) {
    _basemapId = id;
  },

  setInteractionMode(mode: InteractionMode) {
    _interactionMode = mode;
  },

  setMapInstance(map: MapLibreMap | undefined) {
    _mapInstance = map;
  },

  setMapContainerEl(el: HTMLElement | undefined) {
    _mapContainerEl = el;
  },

  /** Sync from saved map viewport data */
  loadViewport(viewport: { center: [number, number]; zoom: number; bearing: number; pitch: number }) {
    _center = viewport.center;
    _zoom = viewport.zoom;
    _bearing = viewport.bearing ?? 0;
    _pitch = viewport.pitch ?? 0;
  },

  /** Get current viewport as a plain object for saving */
  getViewportSnapshot() {
    return { center: _center, zoom: _zoom, bearing: _bearing, pitch: _pitch };
  },

  /**
   * Persist current viewport to localStorage, keyed by mapId.
   * Silently ignores storage errors (e.g. private browsing, quota exceeded).
   */
  saveViewportLocally(mapId: string) {
    try {
      const vp = { center: _center, zoom: _zoom, bearing: _bearing, pitch: _pitch };
      localStorage.setItem(`felt-viewport-${mapId}`, JSON.stringify(vp));
    } catch { /* silently ignore storage errors */ }
  },

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
  },
};
