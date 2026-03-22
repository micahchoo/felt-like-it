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

// pure state machine — no side effects, tool sync handled reactively below
function transitionTo(next: InteractionState) {
  _interactionState = next;
}

// Reactive tool sync: decoupled from transitionTo so effects compose cleanly
let _prevType: InteractionState['type'] = 'idle';
$effect(() => {
  const cur = _interactionState;
  const prev = _prevType;
  _prevType = cur.type;

  switch (cur.type) {
    case 'drawRegion':
      selectionStore.setActiveTool('polygon');
      break;
    case 'pickFeature':
      selectionStore.setActiveTool('select');
      break;
    case 'idle':
      if (prev === 'drawRegion' || prev === 'pickFeature' || prev === 'pendingMeasurement') {
        selectionStore.setActiveTool('select');
      }
      break;
  }
});

export const interactionModes = {
  get state(): InteractionState { return _interactionState; },
  transitionTo,
};
