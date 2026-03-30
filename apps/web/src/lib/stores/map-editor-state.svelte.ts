import { setContext, getContext } from 'svelte';
import type { Map as MapLibreMap } from 'maplibre-gl';
import type { TerraDraw } from 'terra-draw';
import type { GeoJSONFeature } from '@felt-like-it/shared-types';
import type { Geometry } from 'geojson';
import { mutation } from '$lib/debug/effect-tracker.js';
import { resolveFeatureId } from '$lib/utils/resolve-feature-id.js';

// ── Types (moved from interaction-modes + selection + drawing) ─────────────

export type SelectedFeature = {
  featureId: string;
  layerId: string;
  geometry: Geometry;
};

export type PickedFeatureRef = {
  featureId: string;
  layerId: string;
};

export type InteractionState =
  | { type: 'idle' }
  | { type: 'featureSelected'; feature: SelectedFeature }
  | { type: 'drawRegion'; geometry?: { type: 'Polygon'; coordinates: number[][][] } }
  | { type: 'pickFeature'; picked?: PickedFeatureRef }
  | { type: 'pendingMeasurement'; anchor: {
      type: 'measurement';
      geometry: { type: 'LineString'; coordinates: [number, number][] } | { type: 'Polygon'; coordinates: [number, number][][] };
    }; content: {
      type: 'measurement';
      measurementType: 'distance' | 'area';
      value: number;
      unit: string;
      displayValue: string;
    } };

export type DrawTool = 'point' | 'line' | 'polygon' | 'select' | null;

type DrawingState =
  | { status: 'idle' }
  | { status: 'importing'; generation: number }
  | { status: 'ready'; instance: TerraDraw; generation: number }
  | { status: 'stopped' };

// ── Class ──────────────────────────────────────────────────────────────────

const MAP_EDITOR_STATE_KEY = Symbol('MapEditorState');

export class MapEditorState {
  // Interaction state
  #interactionState = $state<InteractionState>({ type: 'idle' });

  // Selection state
  #selectedFeatureIds = $state<Set<string>>(new Set());
  #selectedFeature = $state<GeoJSONFeature | null>(null);
  #activeTool = $state<DrawTool>(null);
  #popupCoords = $state<{ lng: number; lat: number } | null>(null);
  #selectedLayerId = $state<string | null>(null);

  // Drawing state
  #drawingState = $state<DrawingState>({ status: 'idle' });
  #drawingGeneration = 0;

  // ── Getters (reactive reads for components) ────────────────────────────

  get interactionState(): InteractionState { return this.#interactionState; }
  get selectedFeature(): GeoJSONFeature | null { return this.#selectedFeature; }
  get selectedFeatureIds(): Set<string> { return this.#selectedFeatureIds; }
  get activeTool(): DrawTool { return this.#activeTool; }
  get popupCoords(): { lng: number; lat: number } | null { return this.#popupCoords; }
  get selectedLayerId(): string | null { return this.#selectedLayerId; }
  get hasSelection(): boolean { return this.#selectedFeatureIds.size > 0; }
  get drawingStatus(): DrawingState['status'] { return this.#drawingState.status; }
  get isDrawingReady(): boolean { return this.#drawingState.status === 'ready'; }
  get drawingInstance(): TerraDraw | null {
    return this.#drawingState.status === 'ready' ? this.#drawingState.instance : null;
  }

  // ── Atomic methods ─────────────────────────────────────────────────────
  // Each method updates ALL affected state in one synchronous call.
  // No $effect chains needed — the caller gets consistent state immediately.

  transitionTo(next: InteractionState): void {
    mutation('MapEditorState', 'transitionTo', next.type);
    this.#interactionState = next;
    // Inline tool sync (was a separate $effect in interaction-modes.svelte.ts)
    switch (next.type) {
      case 'drawRegion':
        this.#activeTool = 'polygon';
        break;
      case 'pickFeature':
        this.#activeTool = 'select';
        break;
      case 'idle':
        // Only reset tool if coming from a special mode
        // (featureSelected → idle should NOT force tool change)
        break;
    }
  }

  selectFeature(
    feature: GeoJSONFeature,
    coords?: { lng: number; lat: number } | undefined,
    layerId?: string | undefined,
  ): void {
    mutation('MapEditorState', 'selectFeature', { featureId: feature.id, layerId });
    this.#selectedFeature = feature;
    this.#selectedFeatureIds = new Set([String(feature.id ?? '')]);
    this.#popupCoords = coords ?? null;
    this.#selectedLayerId = layerId ?? null;

    // Atomic: also transition to featureSelected (was bridge effect ME:selectionToFeature)
    const geom = feature.geometry as Geometry | undefined;
    const fid = resolveFeatureId(feature as any);
    if (geom && fid && layerId) {
      const currentType = this.#interactionState.type;
      if (currentType === 'idle' || currentType === 'featureSelected') {
        this.#interactionState = {
          type: 'featureSelected',
          feature: { featureId: fid, layerId, geometry: geom },
        };
      } else if (currentType === 'pickFeature' && !(this.#interactionState as any).picked) {
        // Feature pick capture (was bridge effect ME:featurePickCapture)
        this.#interactionState = {
          type: 'pickFeature',
          picked: { featureId: fid, layerId },
        };
      }
    }
  }

  clearSelection(): void {
    if (!this.#selectedFeature && this.#selectedFeatureIds.size === 0) return;
    mutation('MapEditorState', 'clearSelection');
    this.#selectedFeature = null;
    this.#selectedFeatureIds = new Set();
    this.#popupCoords = null;
    this.#selectedLayerId = null;
    // If we were in featureSelected, go idle (was bridge effect ME:selectionToFeature else branch)
    if (this.#interactionState.type === 'featureSelected') {
      this.#interactionState = { type: 'idle' };
    }
  }

  setActiveTool(tool: DrawTool): void {
    mutation('MapEditorState', 'setActiveTool', tool);
    this.#activeTool = tool;
    // Clear selection for draw tools (was hidden side effect in selectionStore.setActiveTool)
    if (tool !== null && tool !== 'select') {
      this.#selectedFeature = null;
      this.#selectedFeatureIds = new Set();
      this.#popupCoords = null;
      this.#selectedLayerId = null;
      // Dismiss featureSelected (was bridge effect ME:toolDismissFeature)
      if (this.#interactionState.type === 'featureSelected') {
        this.#interactionState = { type: 'idle' };
      }
    }
  }

  toggleFeatureId(id: string): void {
    mutation('MapEditorState', 'toggleFeatureId', id);
    const next = new Set(this.#selectedFeatureIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.#selectedFeatureIds = next;
  }

  // ── Context-driven reactions ───────────────────────────────────────────
  // Called by MapEditor when external state changes. Replaces bridge effects
  // ME:sectionCleanup and ME:designModeCleanup.

  handleSectionChange(section: string | null): void {
    if (section !== 'annotations') {
      const t = this.#interactionState.type;
      if (t === 'drawRegion' || t === 'pickFeature' || t === 'pendingMeasurement') {
        mutation('MapEditorState', 'handleSectionChange→idle', section);
        this.#interactionState = { type: 'idle' };
      }
    }
  }

  handleDesignModeChange(designMode: boolean): void {
    if (designMode) {
      mutation('MapEditorState', 'handleDesignModeChange→reset', designMode);
      this.#interactionState = { type: 'idle' };
      this.clearSelection();
      this.#activeTool = 'select';
    }
  }

  // ── Drawing lifecycle ──────────────────────────────────────────────────
  // Moved from drawingStore — same generation-guarded async init pattern.

  async initDrawing(map: MapLibreMap): Promise<TerraDraw | null> {
    const gen = ++this.#drawingGeneration;
    this.#drawingState = { status: 'importing', generation: gen };

    const { TerraDraw: TD, TerraDrawPointMode, TerraDrawLineStringMode,
            TerraDrawPolygonMode, TerraDrawSelectMode } = await import('terra-draw');
    const { TerraDrawMapLibreGLAdapter } = await import('terra-draw-maplibre-gl-adapter');

    // Abort if a newer init started while we were importing
    if (gen !== this.#drawingGeneration) return null;

    const draw = new TD({
      adapter: new TerraDrawMapLibreGLAdapter({ map }),
      modes: [
        new TerraDrawPointMode(),
        new TerraDrawLineStringMode(),
        new TerraDrawPolygonMode({ snapping: { toLine: true, toCoordinate: true } }),
        new TerraDrawSelectMode(),
      ],
    });

    draw.start();
    this.#drawingState = { status: 'ready', instance: draw, generation: gen };
    return draw;
  }

  stopDrawing(): void {
    if (this.#drawingState.status === 'ready') {
      try { this.#drawingState.instance.stop(); }
      catch (err) { console.error('MapEditorState stopDrawing failed:', err); }
    }
    this.#drawingState = { status: 'stopped' };
  }

  /** Reset all state — for test isolation and component teardown. */
  reset(): void {
    if (this.#drawingState.status === 'ready') {
      try { this.#drawingState.instance.stop(); } catch { /* swallow */ }
    }
    this.#interactionState = { type: 'idle' };
    this.#selectedFeature = null;
    this.#selectedFeatureIds = new Set();
    this.#activeTool = null;
    this.#popupCoords = null;
    this.#selectedLayerId = null;
    this.#drawingState = { status: 'idle' };
    this.#drawingGeneration = 0;
  }
}

// ── Context helpers ──────────────────────────────────────────────────────────

export function setMapEditorState(): MapEditorState {
  return setContext(MAP_EDITOR_STATE_KEY, new MapEditorState());
}

export function getMapEditorState(): MapEditorState {
  return getContext<MapEditorState>(MAP_EDITOR_STATE_KEY);
}
