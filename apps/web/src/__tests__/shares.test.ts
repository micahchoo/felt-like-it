// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Module mocks ---

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  maps:   { id: {}, userId: {} },
  shares: { id: {}, mapId: {}, token: {}, accessLevel: {} },
  layers: { id: {}, mapId: {}, zIndex: {} },
}));

vi.mock('$lib/server/audit/index.js', () => ({ appendAuditLog: vi.fn() }));

import { sharesRouter } from '../lib/server/trpc/routers/shares.js';
import { db } from '$lib/server/db/index.js';
import { drizzleChain, mockContext, publicContext } from './test-utils.js';

// --- Helpers ---

const USER_ID  = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID   = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const SHARE_ID = 'cccccccc-0000-0000-0000-cccccccccccc';
const LAYER_ID = 'dddddddd-0000-0000-0000-dddddddddddd';

const MOCK_MAP = {
  id: MAP_ID, userId: USER_ID, title: 'Test Map', description: null,
  viewport: { center: [0, 0], zoom: 4, bearing: 0, pitch: 0 },
  basemap: 'osm', createdAt: new Date(), updatedAt: new Date(),
};

const MOCK_SHARE = {
  id: SHARE_ID, mapId: MAP_ID, token: 'test-token-abc', accessLevel: 'public' as const,
  createdAt: new Date(), updatedAt: new Date(),
};

const MOCK_LAYER = {
  id: LAYER_ID, mapId: MAP_ID, name: 'Layer A', type: 'polygon' as const,
  style: {}, visible: true, zIndex: 0, sourceFileName: null,
  createdAt: new Date(), updatedAt: new Date(),
};

function makeCaller() {
  return sharesRouter.createCaller(mockContext({ userId: USER_ID }));
}

function makePublicCaller() {
  return sharesRouter.createCaller(publicContext());
}

// --- Tests ---

describe('shares.create', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates a new share when none exists (INSERT path)', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))   // map ownership
      .mockReturnValueOnce(drizzleChain([]));           // no existing share
    vi.mocked(db.insert).mockReturnValue(drizzleChain([MOCK_SHARE]));

    const result = await makeCaller().create({ mapId: MAP_ID, accessLevel: 'public' });
    expect(result?.id).toBe(SHARE_ID);
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('updates existing share access level (UPDATE path)', async () => {
    const updatedShare = { ...MOCK_SHARE, accessLevel: 'unlisted' as const };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))    // map ownership
      .mockReturnValueOnce(drizzleChain([MOCK_SHARE])); // existing share found
    vi.mocked(db.update).mockReturnValue(drizzleChain([updatedShare]));

    const result = await makeCaller().create({ mapId: MAP_ID, accessLevel: 'unlisted' });
    expect(result?.accessLevel).toBe('unlisted');
    expect(db.update).toHaveBeenCalledOnce();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when caller does not own map', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().create({ mapId: MAP_ID, accessLevel: 'public' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('shares.getForMap', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the share when one exists', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))    // map ownership
      .mockReturnValueOnce(drizzleChain([MOCK_SHARE])); // share found

    const result = await makeCaller().getForMap({ mapId: MAP_ID });
    expect(result?.id).toBe(SHARE_ID);
    expect(result?.token).toBe('test-token-abc');
  });

  it('returns null when no share exists', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))  // map ownership
      .mockReturnValueOnce(drizzleChain([]));          // no share

    const result = await makeCaller().getForMap({ mapId: MAP_ID });
    expect(result).toBeNull();
  });

  it('throws NOT_FOUND for non-owned map', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().getForMap({ mapId: MAP_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('shares.delete', () => {
  beforeEach(() => vi.resetAllMocks());

  it('deletes the share and returns { deleted: true }', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.delete).mockReturnValue(drizzleChain(undefined));

    const result = await makeCaller().delete({ mapId: MAP_ID });
    expect(result).toEqual({ deleted: true });
    expect(db.delete).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND for non-owned map', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().delete({ mapId: MAP_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('shares.resolve', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns share + map + layers for a valid token', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_SHARE]))    // share lookup by token
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))      // map lookup
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER]));   // layers lookup

    const result = await makePublicCaller().resolve({ token: 'test-token-abc' });
    expect(result.share.id).toBe(SHARE_ID);
    expect(result.map.id).toBe(MAP_ID);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.id).toBe(LAYER_ID);
  });

  it('throws NOT_FOUND for an invalid token', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makePublicCaller().resolve({ token: 'nonexistent-token' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
