import type { GeoJSONFeature } from '@felt-like-it/shared-types';
import { mutation } from '$lib/debug/effect-tracker.js';

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
    mutation('selectionStore', 'selectFeature', { featureId: feature.id, layerId });
    _selectedFeature = feature;
    _selectedFeatureIds = new Set([String(feature.id ?? '')]);
    _popupCoords = coords ?? null;
    _selectedLayerId = layerId ?? null;
  },

  clearSelection() {
    if (!_selectedFeature && _selectedFeatureIds.size === 0) return;
    mutation('selectionStore', 'clearSelection');
    _selectedFeature = null;
    _selectedFeatureIds = new Set();
    _popupCoords = null;
    _selectedLayerId = null;
  },

  setActiveTool(tool: DrawTool) {
    mutation('selectionStore', 'setActiveTool', tool);
    _activeTool = tool;
    // Only clear selection when switching to a drawing tool (point/line/polygon).
    // 'select' tool preserves the selection — that's its purpose.
    // Clearing on 'select' causes an effect cycle: selectFeature(feat) →
    // transitionTo(featureSelected) → setActiveTool('select') → clears feat →
    // effect re-fires → transitionTo(idle) → layerRenderCache recomputes ×N layers.
    if (tool !== null && tool !== 'select') {
      if (_selectedFeature || _selectedFeatureIds.size > 0) {
        mutation('selectionStore', 'setActiveTool→clearSelection', tool);
        _selectedFeature = null;
        _selectedFeatureIds = new Set();
        _popupCoords = null;
        _selectedLayerId = null;
      }
    }
  },

  toggleFeatureId(id: string) {
    mutation('selectionStore', 'toggleFeatureId', id);
    const next = new Set(_selectedFeatureIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    _selectedFeatureIds = next;
  },
};
