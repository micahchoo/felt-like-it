import { untrack } from 'svelte';
import { selectionStore } from './selection.svelte.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SelectedFeature = {
  featureId: string;
  layerId: string;
  geometry: import('geojson').Geometry;
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

// ── State ─────────────────────────────────────────────────────────────────────

let _interactionState = $state<InteractionState>({ type: 'idle' });

// ── Store ─────────────────────────────────────────────────────────────────────

/** Centralized mode transition — atomically sets interactionState and implied tool.
 *  Uses untrack() for the prev-state read so it's safe to call from $effect blocks. */
function transitionTo(next: InteractionState) {
  const prev = untrack(() => _interactionState);
  _interactionState = next;

  // Entry actions: set the tool implied by the target mode
  switch (next.type) {
    case 'drawRegion':
      selectionStore.setActiveTool('polygon');
      break;
    case 'pickFeature':
      selectionStore.setActiveTool('select');
      break;
    case 'idle':
      // Reset tool when leaving annotation-capture modes
      if (prev.type === 'drawRegion' || prev.type === 'pickFeature' || prev.type === 'pendingMeasurement') {
        selectionStore.setActiveTool('select');
      }
      break;
  }
}

export const interactionModes = {
  get state(): InteractionState { return _interactionState; },
  transitionTo,
};
