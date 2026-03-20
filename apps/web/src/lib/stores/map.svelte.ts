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

// Map viewport state
let _center = $state<[number, number]>([-98.35, 39.5]);
let _zoom = $state(4);
let _bearing = $state(0);
let _pitch = $state(0);
let _basemapId = $state<BasemapId>('osm');
let _interactionMode = $state<InteractionMode>('default');
let _mapInstance = $state<MapLibreMap | undefined>(undefined);
/**
 * Viewport version counter — incremented ONLY by loadViewport().
 * Used by MapCanvas to distinguish external (programmatic) viewport changes
 * from map-driven changes flowing through setViewport(), preventing the
 * MC:localToStore ↔ MC:storeToLocal effect cycle during pan/zoom animations.
 */
let _viewportVersion = $state(0);
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
  get viewportVersion() { return _viewportVersion; },

  setViewport(viewport: {
    center?: [number, number];
    zoom?: number;
    bearing?: number;
    pitch?: number;
  }) {
    // Guard each field with equality checks to prevent reactive churn.
    // Without these, the MapLibre center prop → moveend → setViewport → re-render
    // cycle creates an infinite loop (effect_update_depth_exceeded) because each
    // call assigns a new array/value even when coordinates are identical.
    let changed = false;
    if (viewport.center !== undefined &&
        (viewport.center[0] !== _center[0] || viewport.center[1] !== _center[1])) {
      _center = viewport.center;
      changed = true;
    }
    if (viewport.zoom !== undefined && viewport.zoom !== _zoom) { _zoom = viewport.zoom; changed = true; }
    if (viewport.bearing !== undefined && viewport.bearing !== _bearing) { _bearing = viewport.bearing; changed = true; }
    if (viewport.pitch !== undefined && viewport.pitch !== _pitch) { _pitch = viewport.pitch; changed = true; }
    if (changed) mutation('mapStore', 'setViewport', { center: _center, zoom: _zoom });
  },

  setBasemap(id: BasemapId) {
    _basemapId = id;
  },

  setInteractionMode(mode: InteractionMode) {
    _interactionMode = mode;
  },

  setMapInstance(map: MapLibreMap | undefined) {
    mutation('mapStore', 'setMapInstance', map ? 'MapLibreMap' : 'undefined');
    _mapInstance = map;
  },

  setMapContainerEl(el: HTMLElement | undefined) {
    _mapContainerEl = el;
  },

  /** Sync from saved map viewport data (external/programmatic changes) */
  loadViewport(viewport: { center: [number, number]; zoom: number; bearing: number; pitch: number }) {
    _center = viewport.center;
    _zoom = viewport.zoom;
    _bearing = viewport.bearing ?? 0;
    _pitch = viewport.pitch ?? 0;
    _viewportVersion++;
  },

  /** Get current viewport as a plain object for saving */
  getViewportSnapshot() {
    return { center: _center, zoom: _zoom, bearing: _bearing, pitch: _pitch };
  },
};
