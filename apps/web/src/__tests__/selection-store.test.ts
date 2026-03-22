/**
 * Characterization tests for selectionStore (apps/web/src/lib/stores/selection.svelte.ts).
 *
 * Documents the OBSERVED runtime behaviour — not aspirational contracts.
 * Captures:
 *   - selectFeature: sets feature, ids, coords, layerId
 *   - clearSelection: resets all selection state; idempotent on empty state
 *   - setActiveTool: stores tool value; non-null tools clear selection as side effect
 *   - setActiveTool(null): does NOT clear selection (select tool restores focus)
 *   - hasSelection: derived from selectedFeatureIds.size > 0
 *   - toggleFeatureId: adds absent ids, removes present ids
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { selectionStore } from '../lib/stores/selection.svelte.js';
import type { GeoJSONFeature } from '@felt-like-it/shared-types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFeature(id: string): GeoJSONFeature {
  return {
    id,
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [0, 0] },
    properties: {},
  } as GeoJSONFeature;
}

const COORDS = { lng: -122.4, lat: 37.8 };
const LAYER_ID = 'layer-abc';

// ── Reset between tests ───────────────────────────────────────────────────────
// Module-level $state persists across tests — always start clean.
beforeEach(() => {
  selectionStore.clearSelection();
  selectionStore.setActiveTool(null);
});

// ── selectFeature ─────────────────────────────────────────────────────────────

describe('selectionStore.selectFeature', () => {
  it('sets selectedFeature to the given feature', () => {
    const f = makeFeature('feat-1');
    selectionStore.selectFeature(f);
    expect(selectionStore.selectedFeature).toEqual(f);
  });

  it('adds feature id to selectedFeatureIds', () => {
    selectionStore.selectFeature(makeFeature('feat-2'));
    expect(selectionStore.selectedFeatureIds.has('feat-2')).toBe(true);
    expect(selectionStore.selectedFeatureIds.size).toBe(1);
  });

  it('sets hasSelection to true after selecting', () => {
    expect(selectionStore.hasSelection).toBe(false);
    selectionStore.selectFeature(makeFeature('feat-3'));
    expect(selectionStore.hasSelection).toBe(true);
  });

  it('captures optional popupCoords', () => {
    selectionStore.selectFeature(makeFeature('feat-4'), COORDS);
    expect(selectionStore.popupCoords).toEqual(COORDS);
  });

  it('defaults popupCoords to null when omitted', () => {
    selectionStore.selectFeature(makeFeature('feat-5'));
    expect(selectionStore.popupCoords).toBeNull();
  });

  it('captures optional layerId', () => {
    selectionStore.selectFeature(makeFeature('feat-6'), COORDS, LAYER_ID);
    expect(selectionStore.selectedLayerId).toBe(LAYER_ID);
  });

  it('defaults selectedLayerId to null when omitted', () => {
    selectionStore.selectFeature(makeFeature('feat-7'));
    expect(selectionStore.selectedLayerId).toBeNull();
  });

  it('replaces previous selection when called again', () => {
    selectionStore.selectFeature(makeFeature('old'));
    selectionStore.selectFeature(makeFeature('new'));
    expect(selectionStore.selectedFeatureIds.has('old')).toBe(false);
    expect(selectionStore.selectedFeatureIds.has('new')).toBe(true);
    expect(selectionStore.selectedFeatureIds.size).toBe(1);
  });

  it('stringifies numeric feature ids', () => {
    const f = { ...makeFeature('ignored'), id: 42 } as unknown as GeoJSONFeature;
    selectionStore.selectFeature(f);
    expect(selectionStore.selectedFeatureIds.has('42')).toBe(true);
  });
});

// ── clearSelection ────────────────────────────────────────────────────────────

describe('selectionStore.clearSelection', () => {
  it('clears selectedFeature after a selection', () => {
    selectionStore.selectFeature(makeFeature('x'));
    selectionStore.clearSelection();
    expect(selectionStore.selectedFeature).toBeNull();
  });

  it('empties selectedFeatureIds', () => {
    selectionStore.selectFeature(makeFeature('x'));
    selectionStore.clearSelection();
    expect(selectionStore.selectedFeatureIds.size).toBe(0);
  });

  it('sets hasSelection to false', () => {
    selectionStore.selectFeature(makeFeature('x'));
    selectionStore.clearSelection();
    expect(selectionStore.hasSelection).toBe(false);
  });

  it('clears popupCoords', () => {
    selectionStore.selectFeature(makeFeature('x'), COORDS);
    selectionStore.clearSelection();
    expect(selectionStore.popupCoords).toBeNull();
  });

  it('clears selectedLayerId', () => {
    selectionStore.selectFeature(makeFeature('x'), COORDS, LAYER_ID);
    selectionStore.clearSelection();
    expect(selectionStore.selectedLayerId).toBeNull();
  });

  it('is idempotent: calling on empty state does not throw', () => {
    // Already empty after beforeEach — calling again must be safe
    expect(() => selectionStore.clearSelection()).not.toThrow();
  });

  it('is idempotent: state remains empty after double clear', () => {
    selectionStore.selectFeature(makeFeature('y'));
    selectionStore.clearSelection();
    selectionStore.clearSelection(); // second call on already-empty state
    expect(selectionStore.hasSelection).toBe(false);
    expect(selectionStore.selectedFeature).toBeNull();
  });
});

// ── setActiveTool ─────────────────────────────────────────────────────────────

describe('selectionStore.setActiveTool', () => {
  it('stores the active tool value', () => {
    selectionStore.setActiveTool('point');
    expect(selectionStore.activeTool).toBe('point');
  });

  it('clears selection when switching to a drawing tool (point)', () => {
    selectionStore.selectFeature(makeFeature('feat-to-lose'));
    selectionStore.setActiveTool('point');
    expect(selectionStore.hasSelection).toBe(false);
    expect(selectionStore.selectedFeature).toBeNull();
  });

  it('clears selection when switching to polygon tool', () => {
    selectionStore.selectFeature(makeFeature('feat-poly'));
    selectionStore.setActiveTool('polygon');
    expect(selectionStore.hasSelection).toBe(false);
  });

  it('clears selection when switching to line tool', () => {
    selectionStore.selectFeature(makeFeature('feat-line'));
    selectionStore.setActiveTool('line');
    expect(selectionStore.hasSelection).toBe(false);
  });

  it('preserves selection when switching to select tool', () => {
    selectionStore.selectFeature(makeFeature('feat-select'));
    selectionStore.setActiveTool('select');
    // 'select' tool preserves selection — clearing it causes an effect cycle
    // (selectFeature → setActiveTool('select') → clear → re-fire)
    expect(selectionStore.hasSelection).toBe(true);
  });

  it('does NOT clear selection when tool is set to null', () => {
    selectionStore.selectFeature(makeFeature('feat-preserved'));
    selectionStore.setActiveTool(null);
    // Selection should survive — null means no active draw tool
    expect(selectionStore.hasSelection).toBe(true);
    expect(selectionStore.selectedFeature?.id).toBe('feat-preserved');
  });

  it('sets activeTool to null correctly', () => {
    selectionStore.setActiveTool('line');
    selectionStore.setActiveTool(null);
    expect(selectionStore.activeTool).toBeNull();
  });
});

// ── hasSelection ──────────────────────────────────────────────────────────────

describe('selectionStore.hasSelection', () => {
  it('is false on fresh state', () => {
    expect(selectionStore.hasSelection).toBe(false);
  });

  it('reflects toggleFeatureId additions', () => {
    selectionStore.toggleFeatureId('tog-1');
    expect(selectionStore.hasSelection).toBe(true);
  });

  it('returns false when the only toggled id is removed', () => {
    selectionStore.toggleFeatureId('tog-2');
    selectionStore.toggleFeatureId('tog-2'); // toggle off
    expect(selectionStore.hasSelection).toBe(false);
  });
});

// ── toggleFeatureId ───────────────────────────────────────────────────────────

describe('selectionStore.toggleFeatureId', () => {
  it('adds an id not yet in the set', () => {
    selectionStore.toggleFeatureId('id-a');
    expect(selectionStore.selectedFeatureIds.has('id-a')).toBe(true);
  });

  it('removes an id already in the set', () => {
    selectionStore.toggleFeatureId('id-b');
    selectionStore.toggleFeatureId('id-b');
    expect(selectionStore.selectedFeatureIds.has('id-b')).toBe(false);
  });

  it('does not affect other ids when removing one', () => {
    selectionStore.toggleFeatureId('id-c');
    selectionStore.toggleFeatureId('id-d');
    selectionStore.toggleFeatureId('id-c'); // remove c
    expect(selectionStore.selectedFeatureIds.has('id-d')).toBe(true);
    expect(selectionStore.selectedFeatureIds.has('id-c')).toBe(false);
  });
});
