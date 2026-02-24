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
  maps:   { id: {}, userId: {} },
  layers: { id: {}, mapId: {}, zIndex: {} },
}));

// Stub the PostGIS execution so tests don't need a real DB
vi.mock('../lib/server/geo/geoprocessing.js', () => ({
  runGeoprocessing: vi.fn().mockResolvedValue(undefined),
  getOpLayerIds: vi.fn((op: { type: string; layerId?: string; layerIdA?: string; layerIdB?: string }) => {
    if (op.layerId !== undefined) return [op.layerId];
    return [op.layerIdA, op.layerIdB];
  }),
}));

import { geoprocessingRouter } from '../lib/server/trpc/routers/geoprocessing.js';
import { db } from '$lib/server/db/index.js';
import { runGeoprocessing } from '../lib/server/geo/geoprocessing.js';

// --- Helpers ---

function drizzleChain<T>(value: T) {
  const c: Record<string, unknown> = {
    then: (res: (v: T) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(value).then(res, rej),
  };
  for (const m of ['from', 'where', 'orderBy', 'set', 'innerJoin', 'limit']) {
    c[m] = vi.fn(() => c);
  }
  c['values']    = vi.fn(() => ({ returning: vi.fn().mockResolvedValue(value) }));
  c['returning'] = vi.fn().mockResolvedValue(value);
  return c as unknown as ReturnType<typeof db.select>;
}

const USER_ID      = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID       = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const LAYER_ID     = 'cccccccc-0000-0000-0000-cccccccccccc';
const LAYER_ID_B   = 'dddddddd-0000-0000-0000-dddddddddddd';
const NEW_LAYER_ID = 'eeeeeeee-0000-0000-0000-eeeeeeeeeeee';

const MOCK_MAP    = { id: MAP_ID };
const MOCK_LAYER  = { id: LAYER_ID };
const MOCK_LAYER_B = { id: LAYER_ID_B };
const MOCK_NEW_LAYER = { id: NEW_LAYER_ID, name: 'Buffered Layer', mapId: MAP_ID, type: 'mixed', style: {}, visible: true, zIndex: 1, sourceFileName: null };

function makeCaller() {
  return geoprocessingRouter.createCaller({
    user: { id: USER_ID, name: 'Test User' } as unknown as User,
    session: { id: 'sess', userId: USER_ID, expiresAt: new Date(Date.now() + 3600_000), fresh: false },
    event: {} as RequestEvent,
  });
}

// --- Tests ---

describe('geoprocessing.run — single-layer ops', () => {
  // clearAllMocks preserves mockImplementation (needed for getOpLayerIds) while still
// flushing the mockReturnValueOnce queues on db.select / db.insert between tests.
beforeEach(() => vi.clearAllMocks());

  it('creates output layer and runs buffer op', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))           // ownership
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER]))         // layer on map
      .mockReturnValueOnce(drizzleChain([{ zIndex: 0 }]));    // max zIndex
    vi.mocked(db.insert).mockReturnValue(
      drizzleChain([MOCK_NEW_LAYER]) as unknown as ReturnType<typeof db.insert>
    );

    const result = await makeCaller().run({
      mapId: MAP_ID,
      op: { type: 'buffer', layerId: LAYER_ID, distanceKm: 1 },
      outputLayerName: 'Buffered Layer',
    });

    expect(result.layerId).toBe(NEW_LAYER_ID);
    expect(result.layerName).toBe('Buffered Layer');
    expect(runGeoprocessing).toHaveBeenCalledOnce();
  });

  it('runs centroid op', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER]))
      .mockReturnValueOnce(drizzleChain([]));                  // no existing layers → maxZ = -1
    vi.mocked(db.insert).mockReturnValue(
      drizzleChain([MOCK_NEW_LAYER]) as unknown as ReturnType<typeof db.insert>
    );

    const result = await makeCaller().run({
      mapId: MAP_ID,
      op: { type: 'centroid', layerId: LAYER_ID },
      outputLayerName: 'Centroids',
    });

    expect(result.layerId).toBe(NEW_LAYER_ID);
    expect(runGeoprocessing).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND when map does not belong to caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().run({
        mapId: MAP_ID,
        op: { type: 'union', layerId: LAYER_ID },
        outputLayerName: 'Union',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND when input layer is not on the map', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([])); // layer not found

    await expect(
      makeCaller().run({
        mapId: MAP_ID,
        op: { type: 'convex_hull', layerId: LAYER_ID },
        outputLayerName: 'Hull',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('validates buffer distanceKm must be positive', async () => {
    await expect(
      makeCaller().run({
        mapId: MAP_ID,
        op: { type: 'buffer', layerId: LAYER_ID, distanceKm: -5 },
        outputLayerName: 'Bad Buffer',
      })
    ).rejects.toThrow();
  });

  it('validates buffer distanceKm must not exceed 1000', async () => {
    await expect(
      makeCaller().run({
        mapId: MAP_ID,
        op: { type: 'buffer', layerId: LAYER_ID, distanceKm: 5000 },
        outputLayerName: 'Huge Buffer',
      })
    ).rejects.toThrow();
  });
});

describe('geoprocessing.run — two-layer ops', () => {
  // clearAllMocks preserves mockImplementation (needed for getOpLayerIds) while still
// flushing the mockReturnValueOnce queues on db.select / db.insert between tests.
beforeEach(() => vi.clearAllMocks());

  it('creates output layer and runs intersect op', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))      // ownership
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER]))    // layer A verified
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER_B]))  // layer B verified
      .mockReturnValueOnce(drizzleChain([{ zIndex: 2 }])); // max zIndex
    vi.mocked(db.insert).mockReturnValue(
      drizzleChain([MOCK_NEW_LAYER]) as unknown as ReturnType<typeof db.insert>
    );

    const result = await makeCaller().run({
      mapId: MAP_ID,
      op: { type: 'intersect', layerIdA: LAYER_ID, layerIdB: LAYER_ID_B },
      outputLayerName: 'Intersection',
    });

    expect(result.layerId).toBe(NEW_LAYER_ID);
  });

  it('throws NOT_FOUND when one input layer is not on the map', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))  // ownership
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER])) // layer A found
      .mockReturnValueOnce(drizzleChain([]));           // layer B NOT found → throws

    await expect(
      makeCaller().run({
        mapId: MAP_ID,
        op: { type: 'clip', layerIdA: LAYER_ID, layerIdB: LAYER_ID_B },
        outputLayerName: 'Clip',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
