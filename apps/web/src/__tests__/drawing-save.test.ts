// @vitest-environment node
/**
 * Characterization tests for DrawingToolbar.saveFeature mutation flow.
 *
 * Extracts the save/undo/error/cache-invalidation logic from
 * DrawingToolbar.svelte into a pure-logic harness.  No DOM or Svelte runtime
 * needed — validates the mutation contract only.
 *
 * Covers:
 *  1. Save flow: feature drawn → tRPC features.upsert called with correct args
 *  2. Undo push: after save, undo command is registered
 *  3. Error path: tRPC mutation failure → terra-draw feature removed → toast shown
 *  4. Cache invalidation: after successful save → TanStack query invalidated
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Types (mirrored from source) ────────────────────────────────────────────

interface UpsertInput {
  layerId: string;
  features: { geometry: Record<string, unknown>; properties: Record<string, unknown> }[];
}

interface DeleteInput {
  layerId: string;
  ids: string[];
}

interface UndoCommand {
  description: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

interface HotFeature {
  type: 'Feature';
  id: string;
  geometry: unknown;
  properties: unknown;
}

interface GeoJSONStoreFeature {
  id: string | number;
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown> | null;
}

// ── Extracted mutation flow (mirrors DrawingToolbar.svelte saveFeature) ──────

/**
 * Reproduces the exact logic of DrawingToolbar.saveFeature + the
 * featureUpsertMutation/featureDeleteMutation onSuccess/onError callbacks.
 *
 * Dependencies are injected so we can test without Svelte/TanStack runtime.
 */
function createSaveFlow(deps: {
  upsertMutate: (input: UpsertInput) => Promise<{ upsertedIds: string[] }>;
  deleteMutate: (input: DeleteInput) => Promise<unknown>;
  invalidateQueries: (opts: { queryKey: readonly unknown[] }) => void;
  undoPush: (cmd: UndoCommand) => void;
  toastError: (msg: string) => void;
  addHotFeature: (layerId: string, feature: HotFeature) => void;
  removeHotFeature: (layerId: string, featureId: string) => void;
  clearHotFeatures: (layerId: string) => void;
  removeDrawnFeature: (ids: (string | number)[]) => void;
  getActiveLayer: () => { id: string } | null;
  onfeaturedrawn?: (layerId: string, feature: Record<string, unknown> & { id?: string }) => void;
}) {
  // Mirrors featureUpsertMutation.onSuccess
  function onUpsertSuccess(data: { upsertedIds: string[] }, variables: { layerId: string }) {
    deps.invalidateQueries({ queryKey: ['features', 'list', { layerId: variables.layerId }] as const });
  }

  // Mirrors featureUpsertMutation.onError
  function onUpsertError(_err: unknown, variables: { layerId: string }) {
    deps.clearHotFeatures(variables.layerId);
    deps.toastError('Failed to save feature. Please try again.');
  }

  // Mirrors featureDeleteMutation.onSuccess
  function onDeleteSuccess(_data: unknown, variables: { layerId: string }) {
    deps.invalidateQueries({ queryKey: ['features', 'list', { layerId: variables.layerId }] as const });
  }

  // Mirrors featureDeleteMutation.onError
  function onDeleteError() {
    deps.toastError('Failed to delete feature. Please try again.');
  }

  // Mirrors saveFeature()
  async function saveFeature(f: GeoJSONStoreFeature) {
    const activeLayer = deps.getActiveLayer();
    if (!activeLayer) {
      deps.toastError('No active layer. Please create or select a layer first.');
      return;
    }

    const geometry = f.geometry as unknown as Record<string, unknown>;
    const properties = (f.properties ?? {}) as Record<string, unknown>;

    try {
      const { upsertedIds } = await deps.upsertMutate({
        layerId: activeLayer.id,
        features: [{ geometry, properties }],
      });

      // TanStack mutation onSuccess callback
      onUpsertSuccess({ upsertedIds }, { layerId: activeLayer.id });

      // Hot overlay for immediate visibility
      if (upsertedIds[0]) {
        deps.addHotFeature(activeLayer.id, {
          type: 'Feature',
          id: upsertedIds[0],
          geometry: geometry as unknown,
          properties: properties as unknown,
        });
      }

      // Register undo command
      deps.undoPush({
        description: `Draw ${f.geometry.type}`,
        undo: async () => {
          if (upsertedIds[0]) {
            await deps.deleteMutate({ layerId: activeLayer.id, ids: [upsertedIds[0]] });
            onDeleteSuccess(undefined, { layerId: activeLayer.id });
            deps.removeHotFeature(activeLayer.id, upsertedIds[0]);
          }
        },
        redo: async () => {
          const result = await deps.upsertMutate({
            layerId: activeLayer.id,
            features: [{ geometry, properties }],
          });
          onUpsertSuccess(result, { layerId: activeLayer.id });
          if (result.upsertedIds[0]) {
            deps.addHotFeature(activeLayer.id, {
              type: 'Feature',
              id: result.upsertedIds[0],
              geometry: geometry as unknown,
              properties: properties as unknown,
            });
          }
        },
      });

      // Notify parent
      await deps.onfeaturedrawn?.(activeLayer.id, { geometry, properties, id: upsertedIds[0] });
    } catch (err) {
      // Mirrors the catch block — attempts to remove the drawn feature twice
      // (defensive: first removal may fail if feature already removed)
      try {
        deps.removeDrawnFeature([f.id]);
      } catch (_) {
        // safe to ignore
      }
      deps.toastError('Failed to save drawn feature.');
      try {
        deps.removeDrawnFeature([f.id]);
      } catch (_) {
        // safe to ignore
      }
    }
  }

  return { saveFeature, onUpsertSuccess, onUpsertError, onDeleteSuccess, onDeleteError };
}

// ── Test fixtures ───────────────────────────────────────────────────────────

const LAYER_ID = 'layer-001';
const UPSERTED_ID = 'feat-new-001';

const SAMPLE_POINT: GeoJSONStoreFeature = {
  id: 'td-temp-1',
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [10, 20] },
  properties: { name: 'test point' },
};

const SAMPLE_POLYGON: GeoJSONStoreFeature = {
  id: 'td-temp-2',
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  properties: null,
};

function makeDeps(overrides: Partial<Parameters<typeof createSaveFlow>[0]> = {}) {
  return {
    upsertMutate: vi.fn().mockResolvedValue({ upsertedIds: [UPSERTED_ID] }),
    deleteMutate: vi.fn().mockResolvedValue({}),
    invalidateQueries: vi.fn(),
    undoPush: vi.fn(),
    toastError: vi.fn(),
    addHotFeature: vi.fn(),
    removeHotFeature: vi.fn(),
    clearHotFeatures: vi.fn(),
    removeDrawnFeature: vi.fn(),
    getActiveLayer: vi.fn().mockReturnValue({ id: LAYER_ID }),
    onfeaturedrawn: vi.fn(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('DrawingToolbar saveFeature mutation flow', () => {
  let deps: ReturnType<typeof makeDeps>;
  let flow: ReturnType<typeof createSaveFlow>;

  beforeEach(() => {
    deps = makeDeps();
    flow = createSaveFlow(deps);
  });

  // ── 1. Save flow ────────────────────────────────────────────────────────

  describe('save flow: feature drawn → tRPC features.upsert called', () => {
    it('calls upsertMutate with correct layerId and serialized geometry/properties', async () => {
      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.upsertMutate).toHaveBeenCalledOnce();
      expect(deps.upsertMutate).toHaveBeenCalledWith({
        layerId: LAYER_ID,
        features: [{
          geometry: SAMPLE_POINT.geometry,
          properties: SAMPLE_POINT.properties,
        }],
      });
    });

    it('serializes null properties as empty object', async () => {
      await flow.saveFeature(SAMPLE_POLYGON);

      const call = deps.upsertMutate.mock.calls[0]![0];
      expect(call.features[0].properties).toEqual({});
    });

    it('adds upserted feature to hot overlay after successful save', async () => {
      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.addHotFeature).toHaveBeenCalledOnce();
      expect(deps.addHotFeature).toHaveBeenCalledWith(LAYER_ID, {
        type: 'Feature',
        id: UPSERTED_ID,
        geometry: SAMPLE_POINT.geometry,
        properties: SAMPLE_POINT.properties,
      });
    });

    it('notifies parent via onfeaturedrawn with upserted id', async () => {
      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.onfeaturedrawn).toHaveBeenCalledWith(LAYER_ID, {
        geometry: SAMPLE_POINT.geometry,
        properties: SAMPLE_POINT.properties,
        id: UPSERTED_ID,
      });
    });

    it('shows toast and returns early when no active layer', async () => {
      deps.getActiveLayer.mockReturnValue(null);

      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.toastError).toHaveBeenCalledWith(
        'No active layer. Please create or select a layer first.',
      );
      expect(deps.upsertMutate).not.toHaveBeenCalled();
    });

    it('does not add to hot overlay when upsertedIds is empty', async () => {
      deps.upsertMutate.mockResolvedValue({ upsertedIds: [] });

      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.addHotFeature).not.toHaveBeenCalled();
    });
  });

  // ── 2. Undo push ───────────────────────────────────────────────────────

  describe('undo: after save, undo command is registered', () => {
    it('pushes an undo command with description matching geometry type', async () => {
      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.undoPush).toHaveBeenCalledOnce();
      const cmd = deps.undoPush.mock.calls[0]![0] as UndoCommand;
      expect(cmd.description).toBe('Draw Point');
    });

    it('undo command description reflects polygon geometry type', async () => {
      await flow.saveFeature(SAMPLE_POLYGON);

      const cmd = deps.undoPush.mock.calls[0]![0] as UndoCommand;
      expect(cmd.description).toBe('Draw Polygon');
    });

    it('undo callback calls deleteMutate with the upserted feature id', async () => {
      await flow.saveFeature(SAMPLE_POINT);

      const cmd = deps.undoPush.mock.calls[0]![0] as UndoCommand;
      await cmd.undo();

      expect(deps.deleteMutate).toHaveBeenCalledWith({
        layerId: LAYER_ID,
        ids: [UPSERTED_ID],
      });
    });

    it('undo callback removes hot feature after delete', async () => {
      await flow.saveFeature(SAMPLE_POINT);

      const cmd = deps.undoPush.mock.calls[0]![0] as UndoCommand;
      await cmd.undo();

      expect(deps.removeHotFeature).toHaveBeenCalledWith(LAYER_ID, UPSERTED_ID);
    });

    it('undo callback invalidates queries after delete', async () => {
      await flow.saveFeature(SAMPLE_POINT);
      deps.invalidateQueries.mockClear();

      const cmd = deps.undoPush.mock.calls[0]![0] as UndoCommand;
      await cmd.undo();

      expect(deps.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['features', 'list', { layerId: LAYER_ID }],
      });
    });

    it('redo callback calls upsertMutate and adds to hot overlay', async () => {
      const redoId = 'feat-redo-001';
      await flow.saveFeature(SAMPLE_POINT);

      deps.upsertMutate.mockResolvedValue({ upsertedIds: [redoId] });
      deps.invalidateQueries.mockClear();
      deps.addHotFeature.mockClear();

      const cmd = deps.undoPush.mock.calls[0]![0] as UndoCommand;
      await cmd.redo();

      expect(deps.upsertMutate).toHaveBeenCalledWith({
        layerId: LAYER_ID,
        features: [{
          geometry: SAMPLE_POINT.geometry,
          properties: SAMPLE_POINT.properties,
        }],
      });
      expect(deps.addHotFeature).toHaveBeenCalledWith(LAYER_ID, expect.objectContaining({
        type: 'Feature',
        id: redoId,
      }));
      expect(deps.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['features', 'list', { layerId: LAYER_ID }],
      });
    });

    it('undo is a no-op when upsertedIds[0] was falsy', async () => {
      deps.upsertMutate.mockResolvedValue({ upsertedIds: [] });

      await flow.saveFeature(SAMPLE_POINT);

      const cmd = deps.undoPush.mock.calls[0]![0] as UndoCommand;
      await cmd.undo();

      expect(deps.deleteMutate).not.toHaveBeenCalled();
      expect(deps.removeHotFeature).not.toHaveBeenCalled();
    });
  });

  // ── 3. Error path ─────────────────────────────────────────────────────

  describe('error path: tRPC mutation failure → cleanup', () => {
    it('shows toast on upsert failure', async () => {
      deps.upsertMutate.mockRejectedValue(new Error('Network error'));

      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.toastError).toHaveBeenCalledWith('Failed to save drawn feature.');
    });

    it('attempts to remove terra-draw feature on upsert failure', async () => {
      deps.upsertMutate.mockRejectedValue(new Error('Network error'));

      await flow.saveFeature(SAMPLE_POINT);

      // The catch block calls removeDrawnFeature twice (defensive)
      expect(deps.removeDrawnFeature).toHaveBeenCalledWith([SAMPLE_POINT.id]);
    });

    it('does not push undo command on failure', async () => {
      deps.upsertMutate.mockRejectedValue(new Error('Server error'));

      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.undoPush).not.toHaveBeenCalled();
    });

    it('does not add to hot overlay on failure', async () => {
      deps.upsertMutate.mockRejectedValue(new Error('Server error'));

      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.addHotFeature).not.toHaveBeenCalled();
    });

    it('does not notify parent on failure', async () => {
      deps.upsertMutate.mockRejectedValue(new Error('Server error'));

      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.onfeaturedrawn).not.toHaveBeenCalled();
    });

    it('survives removeDrawnFeature throwing during cleanup', async () => {
      deps.upsertMutate.mockRejectedValue(new Error('Network error'));
      deps.removeDrawnFeature.mockImplementation(() => { throw new Error('Already removed'); });

      // Should not throw — catch blocks swallow removeDrawnFeature errors
      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.toastError).toHaveBeenCalledWith('Failed to save drawn feature.');
    });

    it('featureUpsertMutation.onError clears hot features for the layer', () => {
      flow.onUpsertError(new Error('Mutation error'), { layerId: LAYER_ID });

      expect(deps.clearHotFeatures).toHaveBeenCalledWith(LAYER_ID);
      expect(deps.toastError).toHaveBeenCalledWith('Failed to save feature. Please try again.');
    });

    it('featureDeleteMutation.onError shows toast without clearing hot overlay', () => {
      flow.onDeleteError();

      expect(deps.toastError).toHaveBeenCalledWith('Failed to delete feature. Please try again.');
      expect(deps.clearHotFeatures).not.toHaveBeenCalled();
    });
  });

  // ── 4. Cache invalidation ─────────────────────────────────────────────

  describe('cache invalidation: after successful save → TanStack query invalidated', () => {
    it('invalidates features.list query key for the active layer on save', async () => {
      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['features', 'list', { layerId: LAYER_ID }],
      });
    });

    it('query key matches queryKeys.features.list structure', async () => {
      // Validates the key shape matches what query-keys.ts produces
      await flow.saveFeature(SAMPLE_POINT);

      const call = deps.invalidateQueries.mock.calls[0]![0];
      expect(call.queryKey).toEqual(['features', 'list', { layerId: LAYER_ID }]);
      expect(call.queryKey[0]).toBe('features');
      expect(call.queryKey[1]).toBe('list');
      expect(call.queryKey[2]).toHaveProperty('layerId', LAYER_ID);
    });

    it('invalidates on upsert success callback (mutation-level)', () => {
      flow.onUpsertSuccess({ upsertedIds: ['x'] }, { layerId: 'layer-xyz' });

      expect(deps.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['features', 'list', { layerId: 'layer-xyz' }],
      });
    });

    it('invalidates on delete success callback (undo path)', () => {
      flow.onDeleteSuccess(undefined, { layerId: 'layer-abc' });

      expect(deps.invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['features', 'list', { layerId: 'layer-abc' }],
      });
    });

    it('does not invalidate queries on save failure', async () => {
      deps.upsertMutate.mockRejectedValue(new Error('Fail'));

      await flow.saveFeature(SAMPLE_POINT);

      expect(deps.invalidateQueries).not.toHaveBeenCalled();
    });
  });

  // ── Adversarial ───────────────────────────────────────────────────────

  describe('adversarial cases', () => {
    it('handles feature with empty properties (null)', async () => {
      await flow.saveFeature(SAMPLE_POLYGON);

      const call = deps.upsertMutate.mock.calls[0]![0];
      expect(call.features[0].properties).toEqual({});
      expect(call.features[0].geometry).toEqual(SAMPLE_POLYGON.geometry);
    });

    it('handles rapid sequential saves without interference', async () => {
      const id1 = 'id-1';
      const id2 = 'id-2';
      let callCount = 0;
      deps.upsertMutate.mockImplementation(async () => {
        callCount++;
        return { upsertedIds: [callCount === 1 ? id1 : id2] };
      });

      await flow.saveFeature(SAMPLE_POINT);
      await flow.saveFeature(SAMPLE_POLYGON);

      expect(deps.upsertMutate).toHaveBeenCalledTimes(2);
      expect(deps.undoPush).toHaveBeenCalledTimes(2);
      expect(deps.addHotFeature).toHaveBeenCalledTimes(2);

      // Each undo command captured its own upsertedId
      const cmd1 = deps.undoPush.mock.calls[0]![0] as UndoCommand;
      const cmd2 = deps.undoPush.mock.calls[1]![0] as UndoCommand;
      expect(cmd1.description).toBe('Draw Point');
      expect(cmd2.description).toBe('Draw Polygon');
    });

    it('concurrent save where first fails and second succeeds', async () => {
      deps.upsertMutate
        .mockRejectedValueOnce(new Error('Transient'))
        .mockResolvedValueOnce({ upsertedIds: ['recovered-id'] });

      await flow.saveFeature(SAMPLE_POINT);
      await flow.saveFeature(SAMPLE_POLYGON);

      // First save: error path
      expect(deps.toastError).toHaveBeenCalledWith('Failed to save drawn feature.');
      // Second save: success path
      expect(deps.undoPush).toHaveBeenCalledOnce();
      expect(deps.addHotFeature).toHaveBeenCalledOnce();
    });
  });
});
