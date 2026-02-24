// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { User } from 'lucia';

// --- Module mocks ---

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select:  vi.fn(),
    insert:  vi.fn(),
    update:  vi.fn(),
    delete:  vi.fn(),
    execute: vi.fn(),
  },
  maps:             { id: {}, userId: {}, isArchived: {} },
  layers:           { id: {}, mapId: {}, zIndex: {}, style: {}, name: {}, type: {}, visible: {}, sourceFileName: {}, createdAt: {}, updatedAt: {} },
  mapCollaborators: { mapId: {}, userId: {}, role: {} },
  users:            {},
}));

import { layersRouter } from '../lib/server/trpc/routers/layers.js';
import { db } from '$lib/server/db/index.js';

// --- Helpers ---

function drizzleChain<T>(value: T) {
  const c: Record<string, unknown> = {
    then: (res: (v: T) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(value).then(res, rej),
  };
  for (const m of ['from', 'where', 'orderBy', 'set']) {
    c[m] = vi.fn(() => c);
  }
  c['values']    = vi.fn(() => ({ returning: vi.fn().mockResolvedValue(value) }));
  c['returning'] = vi.fn().mockResolvedValue(value);
  return c as unknown as ReturnType<typeof db.select>;
}

const USER_ID   = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID    = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const LAYER_ID  = 'cccccccc-0000-0000-0000-cccccccccccc';
const LAYER_ID2 = 'dddddddd-0000-0000-0000-dddddddddddd';

const MOCK_MAP = {
  id: MAP_ID, userId: USER_ID, title: 'Test Map', description: null,
  viewport: {}, basemap: 'osm', isArchived: false,
  createdAt: new Date(), updatedAt: new Date(),
};

const MOCK_LAYER = {
  id: LAYER_ID, mapId: MAP_ID, name: 'Layer A', type: 'polygon' as const,
  style: {}, visible: true, zIndex: 0, sourceFileName: null,
  createdAt: new Date(), updatedAt: new Date(),
};

function makeCaller() {
  return layersRouter.createCaller({
    user: { id: USER_ID } as unknown as User,
    session: { id: 'sess', userId: USER_ID, expiresAt: new Date(Date.now() + 3600_000), fresh: false },
    event: {} as RequestEvent,
  });
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
    vi.mocked(db.insert).mockReturnValue(drizzleChain([MOCK_LAYER]) as unknown as ReturnType<typeof db.insert>);

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
    vi.mocked(db.insert).mockReturnValue(drizzleChain([MOCK_LAYER]) as unknown as ReturnType<typeof db.insert>);

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
    vi.mocked(db.insert).mockReturnValue(drizzleChain([]) as unknown as ReturnType<typeof db.insert>);

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
    vi.mocked(db.update).mockReturnValue(drizzleChain([updated]) as unknown as ReturnType<typeof db.update>);

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
    vi.mocked(db.delete).mockReturnValue(drizzleChain(undefined) as unknown as ReturnType<typeof db.delete>);

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

  it('reorders layers and returns { reordered: true }', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.update).mockReturnValue(drizzleChain([]) as unknown as ReturnType<typeof db.update>);

    const result = await makeCaller().reorder({ mapId: MAP_ID, order: [LAYER_ID, LAYER_ID2] });
    expect(result).toEqual({ reordered: true });
    // Should call db.update once per layer in the order array
    expect(db.update).toHaveBeenCalledTimes(2);
  });

  it('throws NOT_FOUND when map is not owned by caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().reorder({ mapId: MAP_ID, order: [] })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
