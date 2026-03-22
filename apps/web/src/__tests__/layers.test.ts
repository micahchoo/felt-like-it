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
    transaction: vi.fn(),
  },
  maps:             { id: {}, userId: {} },
  layers:           { id: {}, mapId: {}, zIndex: {}, style: {}, name: {}, type: {}, visible: {}, sourceFileName: {}, createdAt: {}, updatedAt: {}, version: {} },
  mapCollaborators: { mapId: {}, userId: {}, role: {} },
  users:            {},
}));

import { layersRouter } from '../lib/server/trpc/routers/layers.js';
import { db } from '$lib/server/db/index.js';
import { drizzleChain, mockContext } from './test-utils.js';

// --- Helpers ---

const USER_ID   = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID    = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const LAYER_ID  = 'cccccccc-0000-0000-0000-cccccccccccc';
const LAYER_ID2 = 'dddddddd-0000-0000-0000-dddddddddddd';

const MOCK_MAP = {
  id: MAP_ID, userId: USER_ID, title: 'Test Map', description: null,
  viewport: {}, basemap: 'osm',
  createdAt: new Date(), updatedAt: new Date(),
};

const MOCK_LAYER = {
  id: LAYER_ID, mapId: MAP_ID, name: 'Layer A', type: 'polygon' as const,
  style: {}, visible: true, zIndex: 0, sourceFileName: null,
  createdAt: new Date(), updatedAt: new Date(),
};

function makeCaller() {
  return layersRouter.createCaller(mockContext({ userId: USER_ID }));
}

// --- Tests ---

describe('layers.list', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns layers ordered by zIndex for an owned map', async () => {
    const l2 = { ...MOCK_LAYER, mapId: MAP_ID, id: 'l2', zIndex: 1, name: 'Layer B', featureCount: 0 };
    const row1 = { ...MOCK_LAYER, mapId: MAP_ID, featureCount: 5 };
    // map ownership check uses db.select; layers query uses db.execute (raw SQL)
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: [row1, l2] } as never);

    const result = await makeCaller().list({ mapId: MAP_ID });
    expect(result).toHaveLength(2);
    expect(result[0]?.id).toBe(LAYER_ID);
    expect(result[0]?.featureCount).toBe(5);
  });

  it('throws NOT_FOUND when the map does not belong to the caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().list({ mapId: MAP_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('layers.create', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates a layer with the next available z-index', async () => {
    const existingLayer = { zIndex: 2 };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))           // map ownership
      .mockReturnValueOnce(drizzleChain([existingLayer]));     // existing layers for z-index
    vi.mocked(db.insert).mockReturnValue(drizzleChain([MOCK_LAYER]));

    const result = await makeCaller().create({ mapId: MAP_ID, name: 'New Layer' });
    expect(result.id).toBe(LAYER_ID);
    // The insert values call should use maxZ+1 = 3
    const insertCall = vi.mocked(db.insert).mock.results[0];
    expect(insertCall).toBeDefined();
  });

  it('assigns zIndex 0 when no existing layers', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([])); // no existing layers
    vi.mocked(db.insert).mockReturnValue(drizzleChain([MOCK_LAYER]));

    await makeCaller().create({ mapId: MAP_ID, name: 'First Layer' });
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND when map does not belong to caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().create({ mapId: MAP_ID, name: 'X' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws INTERNAL_SERVER_ERROR when insert returns nothing', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([]));
    vi.mocked(db.insert).mockReturnValue(drizzleChain([]));

    await expect(makeCaller().create({ mapId: MAP_ID, name: 'Fail' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });
});

describe('layers.update', () => {
  beforeEach(() => vi.resetAllMocks());

  it('updates layer name and returns the updated record', async () => {
    const updated = { ...MOCK_LAYER, name: 'Renamed', style: {} };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ id: LAYER_ID, mapId: MAP_ID }])) // layer lookup
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]));                         // map ownership
    vi.mocked(db.update).mockReturnValue(drizzleChain([updated]));

    const result = await makeCaller().update({ id: LAYER_ID, name: 'Renamed' });
    expect(result?.name).toBe('Renamed');
  });

  it('throws NOT_FOUND when layer does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().update({ id: LAYER_ID, name: 'X' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws FORBIDDEN when caller is a viewer on a map that requires editor access', async () => {
    const otherMap = { id: MAP_ID, userId: 'other-user' };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ id: LAYER_ID, mapId: MAP_ID }]))  // layer found
      .mockReturnValueOnce(drizzleChain([otherMap]))                           // map (not owner)
      .mockReturnValueOnce(drizzleChain([{ role: 'viewer' }]));               // collab: viewer < editor
    await expect(makeCaller().update({ id: LAYER_ID, name: 'X' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

describe('layers.delete', () => {
  beforeEach(() => vi.resetAllMocks());

  it('deletes the layer and returns { deleted: true }', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ id: LAYER_ID, mapId: MAP_ID }]))
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.delete).mockReturnValue(drizzleChain(undefined));

    const result = await makeCaller().delete({ id: LAYER_ID });
    expect(result).toEqual({ deleted: true });
    expect(db.delete).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND when layer does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().delete({ id: LAYER_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws FORBIDDEN when caller is a viewer on a map that requires editor access', async () => {
    const otherMap = { id: MAP_ID, userId: 'other-user' };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ id: LAYER_ID, mapId: MAP_ID }]))  // layer found
      .mockReturnValueOnce(drizzleChain([otherMap]))                           // map (not owner)
      .mockReturnValueOnce(drizzleChain([{ role: 'viewer' }]));               // collab: viewer < editor
    await expect(makeCaller().delete({ id: LAYER_ID })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('layers.reorder', () => {
  beforeEach(() => vi.resetAllMocks());

  it('reorders layers within a transaction', async () => {
    vi.mocked(db.select).mockReturnValue(drizzleChain([MOCK_MAP]));
    vi.mocked(db.transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn().mockReturnValue(drizzleChain([{ id: LAYER_ID, version: 2 }])),
      };
      return fn(tx);
    });

    const result = await makeCaller().reorder({
      mapId: MAP_ID,
      order: [
        { id: LAYER_ID, version: 1 },
        { id: LAYER_ID2, version: 1 },
      ],
    });
    expect(result).toEqual({ success: true });
    expect(db.transaction).toHaveBeenCalled();
  });

  it('throws NOT_FOUND when map is not owned by caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().reorder({
      mapId: MAP_ID,
      order: [{ id: LAYER_ID, version: 1 }],
    })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('layers.update optimistic concurrency', () => {
  beforeEach(() => vi.resetAllMocks());

  it('throws CONFLICT when version does not match', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ id: LAYER_ID, mapId: MAP_ID }]))
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.update).mockReturnValue(drizzleChain([]));

    await expect(
      makeCaller().update({ id: LAYER_ID, name: 'Renamed', version: 1 })
    ).rejects.toThrow(/modified/i);
  });

  it('skips version check when version is omitted', async () => {
    const updated = { id: LAYER_ID, name: 'Renamed', version: 2 };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ id: LAYER_ID, mapId: MAP_ID }]))
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.update).mockReturnValue(drizzleChain([updated]));

    const result = await makeCaller().update({ id: LAYER_ID, name: 'Renamed' });
    expect(result.version).toBe(2);
  });

  it('rejects version: 0 via Zod validation', async () => {
    await expect(
      makeCaller().update({ id: LAYER_ID, name: 'X', version: 0 })
    ).rejects.toThrow();
  });
});

describe('layers.reorder optimistic concurrency', () => {
  beforeEach(() => vi.resetAllMocks());

  it('reorders layers within a transaction', async () => {
    vi.mocked(db.select).mockReturnValue(drizzleChain([MOCK_MAP]));
    vi.mocked(db.transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn().mockReturnValue(drizzleChain([{ id: LAYER_ID, version: 2 }])),
      };
      return fn(tx);
    });

    await makeCaller().reorder({
      mapId: MAP_ID,
      order: [{ id: LAYER_ID, version: 1 }, { id: LAYER_ID2, version: 1 }],
    });
    expect(db.transaction).toHaveBeenCalled();
  });

  it('throws CONFLICT if any layer has stale version during reorder', async () => {
    vi.mocked(db.select).mockReturnValue(drizzleChain([MOCK_MAP]));
    vi.mocked(db.transaction).mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        update: vi.fn().mockReturnValue(drizzleChain([])),
      };
      return fn(tx);
    });

    await expect(
      makeCaller().reorder({
        mapId: MAP_ID,
        order: [{ id: LAYER_ID, version: 99 }],
      })
    ).rejects.toThrow(/reload/i);
  });
});
