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

const USER_ID  = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID   = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const LAYER_ID = 'cccccccc-0000-0000-0000-cccccccccccc';

const MOCK_MAP   = { id: MAP_ID, userId: USER_ID };
const MOCK_LAYER = { id: LAYER_ID, mapId: MAP_ID };

function makeCaller() {
  return featuresRouter.createCaller(mockContext({ userId: USER_ID }));
}

/** Set up the two db.select calls needed for a happy-path access check. */
function setupAccessOk() {
  vi.mocked(db.select)
    .mockReturnValueOnce(drizzleChain([MOCK_LAYER]))  // layer lookup
    .mockReturnValueOnce(drizzleChain([MOCK_MAP]));   // requireMapAccess: map owner
}

const MOCK_ROW = {
  id: 'dddddddd-0000-0000-0000-dddddddddddd',
  properties: { name: 'test' },
  geometry_type: 'ST_Point',
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

// --- Tests ---

describe('features.listPaged', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns paginated rows with total count', async () => {
    setupAccessOk();
    // count query → data query
    vi.mocked(db.execute)
      .mockResolvedValueOnce(mockExecuteResult([{ total: 42 }]))
      .mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]));

    const result = await makeCaller().listPaged({ layerId: LAYER_ID });

    expect(result.total).toBe(42);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.id).toBe(MOCK_ROW.id);
    expect(result.rows[0]?.geometryType).toBe('ST_Point');
    expect(result.rows[0]?.properties).toEqual(MOCK_ROW.properties);
  });

  it('applies bbox filter (execute called twice: count + rows)', async () => {
    setupAccessOk();
    vi.mocked(db.execute)
      .mockResolvedValueOnce(mockExecuteResult([{ total: 1 }]))
      .mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]));

    const result = await makeCaller().listPaged({
      layerId: LAYER_ID,
      bbox: [-10, -10, 10, 10],
    });

    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    // Both count and data queries must have been issued
    expect(db.execute).toHaveBeenCalledTimes(2);
  });

  it('rejects sortBy values not in the allowed enum', async () => {
    await expect(
      makeCaller().listPaged({
        layerId: LAYER_ID,
        // @ts-expect-error — intentional bad value for runtime validation test
        sortBy: 'properties',
      })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('returns empty rows when no features match', async () => {
    setupAccessOk();
    vi.mocked(db.execute)
      .mockResolvedValueOnce(mockExecuteResult([{ total: 0 }]))
      .mockResolvedValueOnce(mockExecuteResult([]));

    const result = await makeCaller().listPaged({ layerId: LAYER_ID });

    expect(result.total).toBe(0);
    expect(result.rows).toHaveLength(0);
  });

  it('throws NOT_FOUND when layer does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().listPaged({ layerId: LAYER_ID })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects limit greater than 200 (Zod clamps at max)', async () => {
    await expect(
      makeCaller().listPaged({ layerId: LAYER_ID, limit: 201 })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('handles offset beyond total gracefully — returns empty rows with correct total', async () => {
    setupAccessOk();
    vi.mocked(db.execute)
      .mockResolvedValueOnce(mockExecuteResult([{ total: 5 }]))
      .mockResolvedValueOnce(mockExecuteResult([]));

    const result = await makeCaller().listPaged({
      layerId: LAYER_ID,
      offset: 1000,
      limit: 50,
    });

    expect(result.total).toBe(5);
    expect(result.rows).toHaveLength(0);
  });
});
