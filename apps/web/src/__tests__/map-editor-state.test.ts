// @vitest-environment node
/**
 * MapEditorState — consolidated state machine tests.
 *
 * Validates that MapEditorState provides ATOMIC operations that update
 * interaction state + selection + tool in a single synchronous method call,
 * eliminating the 5 bridge effects in useInteractionBridge.svelte.ts.
 *
 * No DOM or Svelte runtime needed — pure state logic with $state reactivity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock terra-draw dynamic imports ─────────────────────────────────────────
// MapEditorState.initDrawing() does:
//   const { TerraDraw, ... } = await import('terra-draw');
//   const { TerraDrawMapLibreGLAdapter } = await import('terra-draw-maplibre-gl-adapter');
//
// Same mock pattern as drawing-store.test.ts.

const mockStop = vi.fn();
const mockStart = vi.fn();

/** Minimal mode stub — only needs to satisfy TerraDraw's constructor iteration. */
function modeStub() {
  return { register: vi.fn(), start: vi.fn(), stop: vi.fn(), name: 'mock' };
}

const MockTerraDraw = vi.fn().mockImplementation(() => ({
  start: mockStart,
  stop: mockStop,
}));

vi.mock('terra-draw', () => ({
  TerraDraw: MockTerraDraw,
  TerraDrawPointMode: vi.fn().mockImplementation(modeStub),
  TerraDrawLineStringMode: vi.fn().mockImplementation(modeStub),
  TerraDrawPolygonMode: vi.fn().mockImplementation(modeStub),
  TerraDrawSelectMode: vi.fn().mockImplementation(modeStub),
}));

vi.mock('terra-draw-maplibre-gl-adapter', () => ({
  TerraDrawMapLibreGLAdapter: vi.fn().mockImplementation(() => ({})),
}));

// Mock effect-tracker — no-op in tests (no browser, no window.__EFFECT_DEBUG)
vi.mock('$lib/debug/effect-tracker.js', () => ({
  mutation: vi.fn(),
  effectEnter: vi.fn(),
  effectExit: vi.fn(),
  storeRead: vi.fn(),
}));

// Mock svelte context API — not used in unit tests but imported by the module
vi.mock('svelte', () => ({
  setContext: vi.fn(),
  getContext: vi.fn(),
}));

// Import AFTER mocks
import { MapEditorState } from '../lib/stores/map-editor-state.svelte.js';
import type { InteractionState } from '../lib/stores/map-editor-state.svelte.js';

// ─── Test helpers ────────────────────────────────────────────────────────────

/** Valid UUIDs — resolveFeatureId validates UUID format via toFeatureUUID. */
const UUID1 = '00000000-0000-0000-0000-000000000001';
const UUID2 = '00000000-0000-0000-0000-000000000002';

/** Minimal GeoJSON feature for testing. Uses valid UUIDs so resolveFeatureId works. */
function makeFeature(id: string = UUID1, geomType: string = 'Point', coords: unknown = [0, 0]) {
  return {
    id,
    type: 'Feature' as const,
    geometry: { type: geomType, coordinates: coords },
    properties: { _id: id },
  };
}

/** Minimal MapLibre map stub for initDrawing. */
function makeMapStub() {
  return {} as any;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('MapEditorState', () => {
  let state: MapEditorState;

  beforeEach(() => {
    state = new MapEditorState();
    vi.clearAllMocks();
  });

  // ── 1. Initial state ────────────────────────────────────────────────────

  describe('initial state', () => {
    it('starts idle with no selection, no tool, drawing idle', () => {
      expect(state.interactionState.type).toBe('idle');
      expect(state.selectedFeature).toBeNull();
      expect(state.selectedFeatureIds.size).toBe(0);
      expect(state.activeTool).toBeNull();
      expect(state.hasSelection).toBe(false);
      expect(state.drawingStatus).toBe('idle');
      expect(state.isDrawingReady).toBe(false);
      expect(state.drawingInstance).toBeNull();
      expect(state.popupCoords).toBeNull();
      expect(state.selectedLayerId).toBeNull();
    });
  });

  // ── 2. Atomic selectFeature ─────────────────────────────────────────────

  describe('selectFeature (atomic)', () => {
    it('sets selection AND transitions to featureSelected in one call', () => {
      const feat = makeFeature(UUID1);
      state.selectFeature(feat as any, { lng: 1, lat: 2 }, 'layer1');

      // Selection state updated
      expect(state.selectedFeature?.id).toBe(UUID1);
      expect(state.selectedFeatureIds.has(UUID1)).toBe(true);
      expect(state.hasSelection).toBe(true);
      expect(state.popupCoords).toEqual({ lng: 1, lat: 2 });
      expect(state.selectedLayerId).toBe('layer1');

      // Interaction state atomically transitioned
      expect(state.interactionState.type).toBe('featureSelected');
      if (state.interactionState.type === 'featureSelected') {
        expect(state.interactionState.feature.featureId).toBe(UUID1);
        expect(state.interactionState.feature.layerId).toBe('layer1');
        expect(state.interactionState.feature.geometry).toEqual({
          type: 'Point',
          coordinates: [0, 0],
        });
      }
    });

    it('replaces previous selection atomically', () => {
      state.selectFeature(makeFeature(UUID1) as any, undefined, 'l1');
      state.selectFeature(makeFeature(UUID2, 'LineString', [[0, 0], [1, 1]]) as any, { lng: 5, lat: 5 }, 'l2');

      expect(state.selectedFeature?.id).toBe(UUID2);
      expect(state.selectedFeatureIds.has(UUID1)).toBe(false);
      expect(state.selectedFeatureIds.has(UUID2)).toBe(true);
      expect(state.selectedLayerId).toBe('l2');
      if (state.interactionState.type === 'featureSelected') {
        expect(state.interactionState.feature.featureId).toBe(UUID2);
      }
    });

    it('does not transition when no layerId provided', () => {
      state.selectFeature(makeFeature(UUID1) as any);
      expect(state.selectedFeature?.id).toBe(UUID1);
      // Without layerId, interaction state stays idle
      expect(state.interactionState.type).toBe('idle');
    });

    it('sets selectedFeatureIds from feature.id, defaulting to empty string', () => {
      const noId = { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} };
      state.selectFeature(noId as any, undefined, 'l1');
      expect(state.selectedFeatureIds.has('')).toBe(true);
    });
  });

  // ── 3. Atomic setActiveTool ─────────────────────────────────────────────

  describe('setActiveTool (atomic)', () => {
    it('sets tool and clears selection for draw tools', () => {
      // Set up selection first
      state.selectFeature(makeFeature(UUID1) as any, { lng: 0, lat: 0 }, 'l1');
      expect(state.hasSelection).toBe(true);
      expect(state.interactionState.type).toBe('featureSelected');

      // Switch to polygon — should clear selection AND dismiss featureSelected
      state.setActiveTool('polygon');
      expect(state.activeTool).toBe('polygon');
      expect(state.hasSelection).toBe(false);
      expect(state.selectedFeature).toBeNull();
      expect(state.interactionState.type).toBe('idle');
    });

    it('preserves selection when switching to select tool', () => {
      state.selectFeature(makeFeature(UUID1) as any, undefined, 'l1');
      state.setActiveTool('select');
      expect(state.hasSelection).toBe(true);
      expect(state.selectedFeature?.id).toBe(UUID1);
    });

    it('clears selection for point tool', () => {
      state.selectFeature(makeFeature(UUID1) as any, undefined, 'l1');
      state.setActiveTool('point');
      expect(state.hasSelection).toBe(false);
    });

    it('clears selection for line tool', () => {
      state.selectFeature(makeFeature(UUID1) as any, undefined, 'l1');
      state.setActiveTool('line');
      expect(state.hasSelection).toBe(false);
    });

    it('handles null tool without clearing', () => {
      state.selectFeature(makeFeature(UUID1) as any, undefined, 'l1');
      state.setActiveTool(null);
      expect(state.hasSelection).toBe(true);
    });
  });

  // ── 4. transitionTo tool sync ───────────────────────────────────────────

  describe('transitionTo tool sync', () => {
    it('drawRegion sets activeTool to polygon', () => {
      state.transitionTo({ type: 'drawRegion' });
      expect(state.interactionState.type).toBe('drawRegion');
      expect(state.activeTool).toBe('polygon');
    });

    it('pickFeature sets activeTool to select', () => {
      state.transitionTo({ type: 'pickFeature' });
      expect(state.interactionState.type).toBe('pickFeature');
      expect(state.activeTool).toBe('select');
    });

    it('idle does not force tool change', () => {
      state.setActiveTool('polygon');
      state.transitionTo({ type: 'idle' });
      expect(state.interactionState.type).toBe('idle');
      // Tool remains polygon — idle doesn't force reset
      expect(state.activeTool).toBe('polygon');
    });

    it('featureSelected does not change tool', () => {
      state.setActiveTool('select');
      const feature = { featureId: 'f1', layerId: 'l1', geometry: { type: 'Point' as const, coordinates: [0, 0] } };
      state.transitionTo({ type: 'featureSelected', feature });
      expect(state.activeTool).toBe('select');
    });

    it('pendingMeasurement does not change tool', () => {
      state.setActiveTool('select');
      const pm: InteractionState = {
        type: 'pendingMeasurement',
        anchor: {
          type: 'measurement',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        },
        content: {
          type: 'measurement',
          measurementType: 'distance',
          value: 100,
          unit: 'm',
          displayValue: '100 m',
        },
      };
      state.transitionTo(pm);
      expect(state.interactionState.type).toBe('pendingMeasurement');
      expect(state.activeTool).toBe('select');
    });
  });

  // ── 5. handleSectionChange ──────────────────────────────────────────────

  describe('handleSectionChange', () => {
    it('resets drawRegion to idle when section is not annotations', () => {
      state.transitionTo({ type: 'drawRegion' });
      state.handleSectionChange('layers');
      expect(state.interactionState.type).toBe('idle');
    });

    it('resets pickFeature to idle when section is not annotations', () => {
      state.transitionTo({ type: 'pickFeature' });
      state.handleSectionChange('analysis');
      expect(state.interactionState.type).toBe('idle');
    });

    it('resets pendingMeasurement to idle when section is not annotations', () => {
      const pm: InteractionState = {
        type: 'pendingMeasurement',
        anchor: {
          type: 'measurement',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        },
        content: {
          type: 'measurement',
          measurementType: 'distance',
          value: 50,
          unit: 'm',
          displayValue: '50 m',
        },
      };
      state.transitionTo(pm);
      state.handleSectionChange('layers');
      expect(state.interactionState.type).toBe('idle');
    });

    it('does not reset idle when section changes', () => {
      state.handleSectionChange('layers');
      expect(state.interactionState.type).toBe('idle');
    });

    it('does not reset featureSelected when section changes', () => {
      const feature = { featureId: 'f1', layerId: 'l1', geometry: { type: 'Point' as const, coordinates: [0, 0] } };
      state.transitionTo({ type: 'featureSelected', feature });
      state.handleSectionChange('layers');
      expect(state.interactionState.type).toBe('featureSelected');
    });

    it('preserves state when section IS annotations', () => {
      state.transitionTo({ type: 'drawRegion' });
      state.handleSectionChange('annotations');
      expect(state.interactionState.type).toBe('drawRegion');
    });

    it('handles null section (not annotations)', () => {
      state.transitionTo({ type: 'pickFeature' });
      state.handleSectionChange(null);
      expect(state.interactionState.type).toBe('idle');
    });
  });

  // ── 6. handleDesignModeChange ───────────────────────────────────────────

  describe('handleDesignModeChange', () => {
    it('resets to idle, clears selection, sets tool to select when designMode=true', () => {
      state.selectFeature(makeFeature(UUID1) as any, { lng: 1, lat: 2 }, 'l1');
      state.transitionTo({ type: 'drawRegion' });

      state.handleDesignModeChange(true);

      expect(state.interactionState.type).toBe('idle');
      expect(state.hasSelection).toBe(false);
      expect(state.selectedFeature).toBeNull();
      expect(state.activeTool).toBe('select');
    });

    it('does nothing when designMode=false', () => {
      state.selectFeature(makeFeature(UUID1) as any, undefined, 'l1');
      const prev = state.interactionState;

      state.handleDesignModeChange(false);

      expect(state.interactionState).toBe(prev);
      expect(state.hasSelection).toBe(true);
    });
  });

  // ── 7. Feature pick capture ─────────────────────────────────────────────

  describe('feature pick capture', () => {
    it('selectFeature during pickFeature captures picked ref', () => {
      state.transitionTo({ type: 'pickFeature' });
      expect(state.interactionState.type).toBe('pickFeature');

      state.selectFeature(makeFeature(UUID1) as any, undefined, 'l1');

      // Should have captured the pick, not transitioned to featureSelected
      expect(state.interactionState.type).toBe('pickFeature');
      if (state.interactionState.type === 'pickFeature') {
        expect(state.interactionState.picked).toEqual({
          featureId: UUID1,
          layerId: 'l1',
        });
      }
    });

    it('does not re-capture if already picked', () => {
      state.transitionTo({
        type: 'pickFeature',
        picked: { featureId: UUID1, layerId: 'l0' },
      });

      state.selectFeature(makeFeature(UUID2) as any, undefined, 'l2');

      // Should NOT overwrite the existing pick — stays as UUID1
      // (the bridge effect also had this guard: `!current.picked`)
      // selectFeature doesn't match idle or featureSelected, and pickFeature has picked,
      // so interactionState is unchanged
      if (state.interactionState.type === 'pickFeature') {
        expect(state.interactionState.picked?.featureId).toBe(UUID1);
      }
    });
  });

  // ── 8. Drawing lifecycle ────────────────────────────────────────────────

  describe('drawing lifecycle', () => {
    it('initDrawing transitions through importing → ready', async () => {
      expect(state.drawingStatus).toBe('idle');

      const result = await state.initDrawing(makeMapStub());

      expect(state.drawingStatus).toBe('ready');
      expect(state.isDrawingReady).toBe(true);
      expect(state.drawingInstance).not.toBeNull();
      expect(result).not.toBeNull();
      expect(mockStart).toHaveBeenCalledOnce();
    });

    it('stopDrawing transitions to stopped', async () => {
      await state.initDrawing(makeMapStub());
      state.stopDrawing();

      expect(state.drawingStatus).toBe('stopped');
      expect(state.isDrawingReady).toBe(false);
      expect(state.drawingInstance).toBeNull();
      expect(mockStop).toHaveBeenCalledOnce();
    });

    it('stopDrawing when not ready still transitions to stopped', () => {
      state.stopDrawing();
      expect(state.drawingStatus).toBe('stopped');
    });

    it('sequential re-init succeeds after reset', async () => {
      // First init succeeds
      const r1 = await state.initDrawing(makeMapStub());
      expect(r1).not.toBeNull();
      expect(state.drawingStatus).toBe('ready');

      // Reset and re-init — generation counter advances, new instance created
      state.reset();
      expect(state.drawingStatus).toBe('idle');

      const r2 = await state.initDrawing(makeMapStub());
      expect(r2).not.toBeNull();
      expect(state.drawingStatus).toBe('ready');
    });
  });

  // ── 9. Adversarial ─────────────────────────────────────────────────────

  describe('adversarial', () => {
    it('rapid tool switching does not corrupt state', () => {
      state.setActiveTool('polygon');
      state.setActiveTool('line');
      state.setActiveTool('point');
      state.setActiveTool('select');
      state.setActiveTool(null);
      state.setActiveTool('polygon');

      expect(state.activeTool).toBe('polygon');
      expect(state.interactionState.type).toBe('idle');
    });

    it('selectFeature during drawRegion does NOT transition to featureSelected', () => {
      state.transitionTo({ type: 'drawRegion' });
      expect(state.activeTool).toBe('polygon');

      state.selectFeature(makeFeature(UUID1) as any, undefined, 'l1');

      // drawRegion is not idle/featureSelected/pickFeature — no transition
      expect(state.interactionState.type).toBe('drawRegion');
      // But selection data IS still updated (component may need it)
      expect(state.selectedFeature?.id).toBe(UUID1);
    });

    it('selectFeature during pendingMeasurement does NOT transition', () => {
      const pm: InteractionState = {
        type: 'pendingMeasurement',
        anchor: {
          type: 'measurement',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
        },
        content: {
          type: 'measurement',
          measurementType: 'area',
          value: 500,
          unit: 'sq m',
          displayValue: '500 sq m',
        },
      };
      state.transitionTo(pm);

      state.selectFeature(makeFeature(UUID1) as any, undefined, 'l1');

      expect(state.interactionState.type).toBe('pendingMeasurement');
    });

    it('clearSelection is idempotent when already empty', () => {
      state.clearSelection();
      expect(state.hasSelection).toBe(false);
      expect(state.interactionState.type).toBe('idle');
    });

    it('clearSelection transitions featureSelected to idle', () => {
      state.selectFeature(makeFeature(UUID1) as any, undefined, 'l1');
      expect(state.interactionState.type).toBe('featureSelected');

      state.clearSelection();
      expect(state.interactionState.type).toBe('idle');
      expect(state.hasSelection).toBe(false);
    });

    it('toggleFeatureId adds and removes ids', () => {
      state.toggleFeatureId('a');
      expect(state.selectedFeatureIds.has('a')).toBe(true);

      state.toggleFeatureId('b');
      expect(state.selectedFeatureIds.has('a')).toBe(true);
      expect(state.selectedFeatureIds.has('b')).toBe(true);

      state.toggleFeatureId('a');
      expect(state.selectedFeatureIds.has('a')).toBe(false);
      expect(state.selectedFeatureIds.has('b')).toBe(true);
    });

    it('multiple selectFeature calls keep state consistent', () => {
      const lastUuid = `00000000-0000-0000-0000-00000000000${9}`;
      for (let i = 0; i < 10; i++) {
        const uuid = `00000000-0000-0000-0000-00000000000${i}`;
        state.selectFeature(makeFeature(uuid) as any, undefined, `l${i}`);
      }
      expect(state.selectedFeature?.id).toBe(lastUuid);
      expect(state.selectedFeatureIds.size).toBe(1);
      expect(state.interactionState.type).toBe('featureSelected');
    });
  });

  // ── 10. reset() ─────────────────────────────────────────────────────────

  describe('reset()', () => {
    it('returns all state to initial values', async () => {
      // Set up complex state
      state.selectFeature(makeFeature(UUID1) as any, { lng: 1, lat: 2 }, 'l1');
      state.setActiveTool('polygon');
      await state.initDrawing(makeMapStub());
      expect(state.isDrawingReady).toBe(true);

      state.reset();

      expect(state.interactionState.type).toBe('idle');
      expect(state.selectedFeature).toBeNull();
      expect(state.selectedFeatureIds.size).toBe(0);
      expect(state.activeTool).toBeNull();
      expect(state.popupCoords).toBeNull();
      expect(state.selectedLayerId).toBeNull();
      expect(state.hasSelection).toBe(false);
      expect(state.drawingStatus).toBe('idle');
      expect(state.isDrawingReady).toBe(false);
      expect(state.drawingInstance).toBeNull();
    });

    it('stops drawing instance before resetting', async () => {
      await state.initDrawing(makeMapStub());
      mockStop.mockClear();

      state.reset();

      expect(mockStop).toHaveBeenCalledOnce();
      expect(state.drawingStatus).toBe('idle');
    });

    it('is safe to call multiple times', () => {
      state.reset();
      state.reset();
      expect(state.interactionState.type).toBe('idle');
    });

    it('allows re-initialization after reset', async () => {
      await state.initDrawing(makeMapStub());
      state.reset();

      const result = await state.initDrawing(makeMapStub());
      expect(result).not.toBeNull();
      expect(state.isDrawingReady).toBe(true);
    });
  });
});
