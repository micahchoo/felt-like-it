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
  layers:           { id: {}, mapId: {} },
  features:         { id: {}, layerId: {} },
  mapCollaborators: { mapId: {}, userId: {}, role: {} },
  maps:             { id: {}, userId: {} },
}));

import { featuresRouter } from '../lib/server/trpc/routers/features.js';
import { db } from '$lib/server/db/index.js';

// --- Helpers ---

function drizzleChain<T>(value: T) {
  const c: Record<string, unknown> = {
    then: (res: (v: T) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(value).then(res, rej),
  };
  for (const m of ['from', 'where', 'orderBy', 'set', 'innerJoin']) {
    c[m] = vi.fn(() => c);
  }
  c['values']    = vi.fn(() => ({ returning: vi.fn().mockResolvedValue(value) }));
  c['returning'] = vi.fn().mockResolvedValue(value);
  return c as unknown as ReturnType<typeof db.select>;
}

const USER_ID   = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID    = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const LAYER_ID  = 'cccccccc-0000-0000-0000-cccccccccccc';
const FEATURE_ID = 'dddddddd-0000-0000-0000-dddddddddddd';

const MOCK_MAP   = { id: MAP_ID, userId: USER_ID };
const MOCK_LAYER = { id: LAYER_ID, mapId: MAP_ID };

function makeCaller() {
  return featuresRouter.createCaller({
    user: { id: USER_ID } as unknown as User,
    session: { id: 'sess', userId: USER_ID, expiresAt: new Date(Date.now() + 3600_000), fresh: false },
    event: {} as RequestEvent,
  });
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

describe('features.upsert', () => {
  beforeEach(() => vi.resetAllMocks());

  const POINT_GEOM = { type: 'Point', coordinates: [0, 0] };

  it('inserts a new feature when no id is provided', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER]))   // layer lookup
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]));    // requireMapAccess: map
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: [{ id: FEATURE_ID }] } as never);

    const result = await makeCaller().upsert({
      layerId: LAYER_ID,
      features: [{ geometry: POINT_GEOM, properties: {} }],
    });
    expect(result.upsertedIds).toHaveLength(1);
    expect(result.upsertedIds[0]).toBe(FEATURE_ID);
  });

  it('updates an existing feature when id is provided', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER]))   // layer lookup
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]));    // requireMapAccess: map
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: [] } as never); // UPDATE returns no rows

    const result = await makeCaller().upsert({
      layerId: LAYER_ID,
      features: [{ id: FEATURE_ID, geometry: POINT_GEOM, properties: {} }],
    });
    // The router pushes feature.id directly for updates (no RETURNING clause)
    expect(result.upsertedIds).toHaveLength(1);
    expect(result.upsertedIds[0]).toBe(FEATURE_ID);
    // Verify the UPDATE SQL was actually executed (not silently skipped)
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND when layer does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().upsert({ layerId: LAYER_ID, features: [{ geometry: POINT_GEOM }] })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws FORBIDDEN when caller is a viewer on a map requiring editor access', async () => {
    const otherMap = { id: MAP_ID, userId: 'other-user' };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER]))              // layer found
      .mockReturnValueOnce(drizzleChain([otherMap]))                // requireMapAccess: map (not owner)
      .mockReturnValueOnce(drizzleChain([{ role: 'viewer' }]));    // collab: viewer < editor

    await expect(
      makeCaller().upsert({ layerId: LAYER_ID, features: [{ geometry: POINT_GEOM }] })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('features.delete', () => {
  beforeEach(() => vi.resetAllMocks());

  it('deletes features and returns count', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER]))   // layer lookup
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]));    // requireMapAccess: map
    vi.mocked(db.delete).mockReturnValue(
      drizzleChain(undefined) as unknown as ReturnType<typeof db.delete>
    );

    const result = await makeCaller().delete({ layerId: LAYER_ID, ids: [FEATURE_ID] });
    expect(result).toEqual({ deleted: 1 });
    expect(db.delete).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND when layer does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().delete({ layerId: LAYER_ID, ids: [FEATURE_ID] })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
