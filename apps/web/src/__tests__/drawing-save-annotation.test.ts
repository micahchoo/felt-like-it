// @vitest-environment node
/**
 * Characterization tests for DrawingToolbar.saveAsAnnotation mutation flow
 * (Phase 3 Wave A.1).
 *
 * Mirrors drawing-save.test.ts in shape: extracts the logic into a pure-logic
 * harness so we can assert the contract without mounting the Svelte component
 * or wiring real TanStack Query.
 *
 * Covers:
 *  1. Anchor derivation per geometry type (Point→point, LineString→path,
 *     Polygon→region) plus rejection of unsupported geometries.
 *  2. Active-layer gate: missing active layer → toast + early return.
 *  3. Name propagation: feature.properties.name → annotation.name.
 *  4. Undo registration: handle captures created id/version; undo + redo
 *     correctly target the live row even after redo recreates with a fresh id.
 *  5. Error path: create-mutation rejection swallowed in the saveAsAnnotation
 *     try/catch (createAnnotationMutationOptions.onError owns rollback + toast).
 *
 * NB: this is a CHARACTERIZATION harness — it reproduces saveAsAnnotation's
 * dispatch shape, NOT its imports. Any change to saveAsAnnotation in
 * DrawingToolbar.svelte must be mirrored here, and vice versa, until A.2 wires
 * dispatch and Wave A.3 retires drawing-save.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Types (mirrored from source) ────────────────────────────────────────────

interface GeoJSONStoreFeature {
  id: string | number;
  type: 'Feature';
  geometry: { type: string; coordinates: unknown };
  properties: Record<string, unknown> | null;
}

interface UndoCommand {
  description: string;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
}

type Anchor =
  | { type: 'point'; geometry: { type: 'Point'; coordinates: [number, number] } }
  | { type: 'path'; geometry: { type: 'LineString'; coordinates: [number, number][] } }
  | { type: 'region'; geometry: { type: 'Polygon'; coordinates: [number, number][][] } };

interface CreateAnnotationInput {
  mapId: string;
  anchor: Anchor;
  content: { kind: 'single'; body: { type: 'text'; text: string } };
  name?: string;
}

interface CreatedAnnotation {
  id: string;
  version: number;
}

// ── Extracted mutation flow (mirrors DrawingToolbar.svelte saveAsAnnotation) ─

function createAnnotationSaveFlow(deps: {
  createAnnotation: (input: CreateAnnotationInput) => Promise<CreatedAnnotation>;
  deleteAnnotation: (input: { id: string; version: number }) => Promise<unknown>;
  undoPush: (cmd: UndoCommand) => void;
  toastError: (msg: string) => void;
  getActiveLayer: () => { id: string; mapId: string } | null;
  /** Wave A.4 — narrow callback for cross-cutting concerns (activity log). */
  onannotationdrawn?: (annotation: { id: string; anchorType: Anchor['type'] }) => void;
}) {
  function deriveAnchor(geometry: { type: string; coordinates: unknown }): Anchor | null {
    if (geometry.type === 'Point') {
      return { type: 'point', geometry: geometry as Anchor & { type: 'point' } extends infer T ? (T extends { geometry: infer G } ? G : never) : never };
    }
    if (geometry.type === 'LineString') {
      return { type: 'path', geometry: geometry as Anchor & { type: 'path' } extends infer T ? (T extends { geometry: infer G } ? G : never) : never };
    }
    if (geometry.type === 'Polygon') {
      return { type: 'region', geometry: geometry as Anchor & { type: 'region' } extends infer T ? (T extends { geometry: infer G } ? G : never) : never };
    }
    return null;
  }

  async function saveAsAnnotation(f: GeoJSONStoreFeature) {
    const activeLayer = deps.getActiveLayer();
    if (!activeLayer) {
      deps.toastError('No active layer. Please create or select a layer first.');
      return;
    }

    const anchor = deriveAnchor(f.geometry);
    if (!anchor) {
      deps.toastError('Unsupported shape type for annotation.');
      return;
    }

    const properties = (f.properties ?? {}) as Record<string, unknown>;
    const propertyName = typeof properties['name'] === 'string' ? (properties['name'] as string) : undefined;
    const mapId = activeLayer.mapId;

    try {
      const created = await deps.createAnnotation({
        mapId,
        anchor,
        content: { kind: 'single', body: { type: 'text', text: '' } },
        ...(propertyName !== undefined ? { name: propertyName } : {}),
      });

      const handle = { id: created.id, version: created.version };
      deps.undoPush({
        description: `Draw ${f.geometry.type}`,
        undo: async () => {
          await deps.deleteAnnotation({ id: handle.id, version: handle.version });
        },
        redo: async () => {
          const recreated = await deps.createAnnotation({
            mapId,
            anchor,
            content: { kind: 'single', body: { type: 'text', text: '' } },
            ...(propertyName !== undefined ? { name: propertyName } : {}),
          });
          handle.id = recreated.id;
          handle.version = recreated.version;
        },
      });

      deps.onannotationdrawn?.({ id: created.id, anchorType: anchor.type });
    } catch {
      // createAnnotationMutationOptions.onError owns rollback + toast
    }
  }

  return { saveAsAnnotation, deriveAnchor };
}

// ── Test fixtures ───────────────────────────────────────────────────────────

const LAYER_ID = 'layer-001';
const MAP_ID = 'map-001';
const CREATED_ID = 'anno-new-001';
const CREATED_VERSION = 1;

const SAMPLE_POINT: GeoJSONStoreFeature = {
  id: 'td-temp-1',
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [10, 20] },
  properties: { name: 'test point' },
};

const SAMPLE_LINE: GeoJSONStoreFeature = {
  id: 'td-temp-2',
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
  properties: null,
};

const SAMPLE_POLYGON: GeoJSONStoreFeature = {
  id: 'td-temp-3',
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] },
  properties: null,
};

const SAMPLE_MULTIPOINT: GeoJSONStoreFeature = {
  id: 'td-temp-4',
  type: 'Feature',
  geometry: { type: 'MultiPoint', coordinates: [[0, 0], [1, 1]] },
  properties: null,
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDeps(overrides: Record<string, any> = {}) {
  return {
    createAnnotation: vi.fn().mockResolvedValue({ id: CREATED_ID, version: CREATED_VERSION }),
    deleteAnnotation: vi.fn().mockResolvedValue({}),
    undoPush: vi.fn(),
    toastError: vi.fn(),
    getActiveLayer: vi.fn().mockReturnValue({ id: LAYER_ID, mapId: MAP_ID }),
    onannotationdrawn: vi.fn(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('DrawingToolbar saveAsAnnotation mutation flow', () => {
  let deps: ReturnType<typeof makeDeps>;
  let flow: ReturnType<typeof createAnnotationSaveFlow>;

  beforeEach(() => {
    deps = makeDeps();
    flow = createAnnotationSaveFlow(deps);
  });

  describe('anchor derivation', () => {
    it('Point geometry yields anchor.type=point with the same coordinates', async () => {
      await flow.saveAsAnnotation(SAMPLE_POINT);
      expect(deps.createAnnotation).toHaveBeenCalledTimes(1);
      const input = deps.createAnnotation.mock.calls[0]?.[0] as CreateAnnotationInput;
      expect(input.anchor.type).toBe('point');
      expect(input.anchor.geometry.coordinates).toEqual([10, 20]);
    });

    it('LineString geometry yields anchor.type=path', async () => {
      await flow.saveAsAnnotation(SAMPLE_LINE);
      const input = deps.createAnnotation.mock.calls[0]?.[0] as CreateAnnotationInput;
      expect(input.anchor.type).toBe('path');
      expect(input.anchor.geometry.coordinates).toEqual([[0, 0], [1, 1]]);
    });

    it('Polygon geometry yields anchor.type=region', async () => {
      await flow.saveAsAnnotation(SAMPLE_POLYGON);
      const input = deps.createAnnotation.mock.calls[0]?.[0] as CreateAnnotationInput;
      expect(input.anchor.type).toBe('region');
    });

    it('unsupported geometry (MultiPoint) toasts and does not call createAnnotation', async () => {
      await flow.saveAsAnnotation(SAMPLE_MULTIPOINT);
      expect(deps.createAnnotation).not.toHaveBeenCalled();
      expect(deps.toastError).toHaveBeenCalledWith('Unsupported shape type for annotation.');
      expect(deps.undoPush).not.toHaveBeenCalled();
    });
  });

  describe('active-layer gate', () => {
    it('no active layer → toast + no createAnnotation call', async () => {
      deps.getActiveLayer.mockReturnValue(null);
      await flow.saveAsAnnotation(SAMPLE_POINT);
      expect(deps.createAnnotation).not.toHaveBeenCalled();
      expect(deps.toastError).toHaveBeenCalledWith(
        'No active layer. Please create or select a layer first.'
      );
      expect(deps.undoPush).not.toHaveBeenCalled();
    });

    it('uses the active layer mapId for the annotation row', async () => {
      deps.getActiveLayer.mockReturnValue({ id: LAYER_ID, mapId: 'different-map' });
      await flow.saveAsAnnotation(SAMPLE_POINT);
      const input = deps.createAnnotation.mock.calls[0]?.[0] as CreateAnnotationInput;
      expect(input.mapId).toBe('different-map');
    });
  });

  describe('content + name propagation', () => {
    it('content body is empty text — user labels via the panel', async () => {
      await flow.saveAsAnnotation(SAMPLE_POINT);
      const input = deps.createAnnotation.mock.calls[0]?.[0] as CreateAnnotationInput;
      expect(input.content).toEqual({ kind: 'single', body: { type: 'text', text: '' } });
    });

    it('properties.name (string) propagates to annotation.name', async () => {
      await flow.saveAsAnnotation(SAMPLE_POINT);
      const input = deps.createAnnotation.mock.calls[0]?.[0] as CreateAnnotationInput;
      expect(input.name).toBe('test point');
    });

    it('absent properties.name → input.name omitted (not null/empty string)', async () => {
      await flow.saveAsAnnotation(SAMPLE_LINE);
      const input = deps.createAnnotation.mock.calls[0]?.[0] as CreateAnnotationInput;
      expect('name' in input).toBe(false);
    });

    it('non-string properties.name (e.g. number) is ignored', async () => {
      const oddFeature: GeoJSONStoreFeature = {
        ...SAMPLE_POINT,
        properties: { name: 42 },
      };
      await flow.saveAsAnnotation(oddFeature);
      const input = deps.createAnnotation.mock.calls[0]?.[0] as CreateAnnotationInput;
      expect('name' in input).toBe(false);
    });
  });

  describe('undo registration', () => {
    it('pushes an undo command with description "Draw <type>"', async () => {
      await flow.saveAsAnnotation(SAMPLE_POLYGON);
      expect(deps.undoPush).toHaveBeenCalledTimes(1);
      const cmd = deps.undoPush.mock.calls[0]?.[0] as UndoCommand;
      expect(cmd.description).toBe('Draw Polygon');
    });

    it('undo() calls deleteAnnotation with the captured id + version', async () => {
      await flow.saveAsAnnotation(SAMPLE_POINT);
      const cmd = deps.undoPush.mock.calls[0]?.[0] as UndoCommand;
      await cmd.undo();
      expect(deps.deleteAnnotation).toHaveBeenCalledWith({
        id: CREATED_ID,
        version: CREATED_VERSION,
      });
    });

    it('redo() recreates with the original input shape', async () => {
      await flow.saveAsAnnotation(SAMPLE_POINT);
      const cmd = deps.undoPush.mock.calls[0]?.[0] as UndoCommand;

      // Simulate undo first (so the row no longer exists), then redo
      await cmd.undo();
      deps.createAnnotation.mockResolvedValueOnce({ id: 'anno-recreated', version: 1 });
      await cmd.redo();

      expect(deps.createAnnotation).toHaveBeenCalledTimes(2);
      const redoCall = deps.createAnnotation.mock.calls[1]?.[0] as CreateAnnotationInput;
      expect(redoCall.anchor.type).toBe('point');
      expect(redoCall.name).toBe('test point');
    });

    it('redo updates the handle so a subsequent undo targets the recreated row', async () => {
      await flow.saveAsAnnotation(SAMPLE_POINT);
      const cmd = deps.undoPush.mock.calls[0]?.[0] as UndoCommand;
      await cmd.undo();

      deps.createAnnotation.mockResolvedValueOnce({ id: 'anno-recreated', version: 7 });
      await cmd.redo();

      // A second undo (after redo) should target the recreated row, not the original
      await cmd.undo();
      expect(deps.deleteAnnotation).toHaveBeenLastCalledWith({
        id: 'anno-recreated',
        version: 7,
      });
    });
  });

  describe('error path', () => {
    it('createAnnotation rejection is swallowed; no undoPush', async () => {
      deps.createAnnotation.mockRejectedValueOnce(new Error('network'));
      await flow.saveAsAnnotation(SAMPLE_POINT);
      expect(deps.undoPush).not.toHaveBeenCalled();
      // saveAsAnnotation does NOT toast on its own — the mutation factory's
      // onError owns user-facing rollback + toast. saveAsAnnotation only catches
      // to prevent the unhandled-rejection from bubbling into TerraDraw.
      expect(deps.toastError).not.toHaveBeenCalled();
    });

    it('createAnnotation rejection means no onannotationdrawn fire', async () => {
      deps.createAnnotation.mockRejectedValueOnce(new Error('network'));
      await flow.saveAsAnnotation(SAMPLE_POINT);
      expect(deps.onannotationdrawn).not.toHaveBeenCalled();
    });
  });

  describe('onannotationdrawn callback (Wave A.4)', () => {
    it('fires once per successful save with id + anchorType', async () => {
      await flow.saveAsAnnotation(SAMPLE_POINT);
      expect(deps.onannotationdrawn).toHaveBeenCalledTimes(1);
      expect(deps.onannotationdrawn).toHaveBeenCalledWith({
        id: CREATED_ID,
        anchorType: 'point',
      });
    });

    it('passes the derived anchorType (path for LineString)', async () => {
      await flow.saveAsAnnotation(SAMPLE_LINE);
      expect(deps.onannotationdrawn).toHaveBeenCalledWith({
        id: CREATED_ID,
        anchorType: 'path',
      });
    });

    it('passes the derived anchorType (region for Polygon)', async () => {
      await flow.saveAsAnnotation(SAMPLE_POLYGON);
      expect(deps.onannotationdrawn).toHaveBeenCalledWith({
        id: CREATED_ID,
        anchorType: 'region',
      });
    });

    it('does not fire for unsupported geometry (no annotation created)', async () => {
      await flow.saveAsAnnotation(SAMPLE_MULTIPOINT);
      expect(deps.onannotationdrawn).not.toHaveBeenCalled();
    });
  });
});
