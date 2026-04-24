// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Module mocks ---

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select:  vi.fn(),
    insert:  vi.fn(),
    update:  vi.fn(),
    delete:  vi.fn(),
    execute: vi.fn(),
  },
  layers:           { id: {}, mapId: {} },
  features:         { id: {}, layerId: {} },
  mapCollaborators: { mapId: {}, userId: {}, role: {} },
  maps:             { id: {}, userId: {} },
}));

import { featuresRouter } from '../lib/server/trpc/routers/features.js';
import { db } from '$lib/server/db/index.js';
import { drizzleChain, mockContext, mockExecuteResult } from './test-utils.js';

// --- Helpers ---

const USER_ID   = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID    = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const LAYER_ID  = 'cccccccc-0000-0000-0000-cccccccccccc';
const FEATURE_ID = 'dddddddd-0000-0000-0000-dddddddddddd';

const MOCK_MAP   = { id: MAP_ID, userId: USER_ID };
const MOCK_LAYER = { id: LAYER_ID, mapId: MAP_ID };

function makeCaller() {
  return featuresRouter.createCaller(mockContext({ userId: USER_ID }));
}

// --- Tests ---

describe('features.list', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns FeatureCollection for a valid layer', async () => {
    const mockRow = {
      id: FEATURE_ID, layer_id: LAYER_ID,
      geometry: { type: 'Point', coordinates: [0, 0] },
      properties: { name: 'test' },
    };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER]))   // layer lookup
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]));    // requireMapAccess: map
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: [mockRow] } as never);

    const result = await makeCaller().list({ layerId: LAYER_ID });
    expect(result.type).toBe('FeatureCollection');
    expect(result.features).toHaveLength(1);
    expect(result.features[0]?.id).toBe(FEATURE_ID);
  });

  it('throws NOT_FOUND when layer does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().list({ layerId: LAYER_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws NOT_FOUND when caller has no access to map', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER]))   // layer found
      .mockReturnValueOnce(drizzleChain([]));            // requireMapAccess: map not found

    await expect(makeCaller().list({ layerId: LAYER_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// features.upsert + features.delete tests removed in baa4 Wave B.3 — the
// procedures themselves were removed once the unified-annotations migration
// (Phase 3) made them application-write-locked. New TerraDraw commits flow
// to annotation_objects via DrawingToolbar.saveAsAnnotation; see
// drawing-save-annotation.test.ts.
