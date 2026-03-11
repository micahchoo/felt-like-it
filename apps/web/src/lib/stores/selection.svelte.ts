import type { GeoJSONFeature } from '@felt-like-it/shared-types';

export type DrawTool = 'point' | 'line' | 'polygon' | 'select' | null;

let _selectedFeatureIds = $state<Set<string>>(new Set());
let _selectedFeature = $state<GeoJSONFeature | null>(null);
let _activeTool = $state<DrawTool>(null);
let _popupCoords = $state<{ lng: number; lat: number } | null>(null);
let _selectedLayerId = $state<string | null>(null);

export const selectionStore = {
  get selectedFeatureIds() { return _selectedFeatureIds; },
  get selectedFeature() { return _selectedFeature; },
  get activeTool() { return _activeTool; },
  get popupCoords() { return _popupCoords; },
  get selectedLayerId() { return _selectedLayerId; },
  get hasSelection() { return _selectedFeatureIds.size > 0; },

  selectFeature(feature: GeoJSONFeature, coords?: { lng: number; lat: number }, layerId?: string) {
    _selectedFeature = feature;
    _selectedFeatureIds = new Set([String(feature.id ?? '')]);
    _popupCoords = coords ?? null;
    _selectedLayerId = layerId ?? null;
  },

  clearSelection() {
    _selectedFeature = null;
    _selectedFeatureIds = new Set();
    _popupCoords = null;
    _selectedLayerId = null;
  },

  setActiveTool(tool: DrawTool) {
    _activeTool = tool;
    if (tool !== null) {
      // Clear selection when switching to a drawing tool
      _selectedFeature = null;
      _selectedFeatureIds = new Set();
      _popupCoords = null;
      _selectedLayerId = null;
    }
  },

  toggleFeatureId(id: string) {
    const next = new Set(_selectedFeatureIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    _selectedFeatureIds = next;
  },
};
