// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Module mocks ---

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select: vi.fn(),
  },
  maps:             { id: {}, userId: {} },
  mapCollaborators: { mapId: {}, userId: {}, role: {} },
}));

import { requireMapAccess } from '../lib/server/geo/access.js';
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

// --- Constants ---

const USER_ID  = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const OTHER_ID = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const MAP_ID   = 'cccccccc-0000-0000-0000-cccccccccccc';

const OWNER_MAP = { id: MAP_ID, userId: USER_ID };
const OTHER_MAP = { id: MAP_ID, userId: OTHER_ID };

// --- Tests ---

describe('requireMapAccess', () => {
  beforeEach(() => vi.resetAllMocks());

  it('resolves when the caller is the map owner (viewer minRole)', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([OWNER_MAP]));
    await expect(requireMapAccess(USER_ID, MAP_ID, 'viewer')).resolves.toBeUndefined();
    expect(db.select).toHaveBeenCalledOnce(); // only one query: the map check
  });

  it('resolves for owner even when minRole is "owner"', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([OWNER_MAP]));
    await expect(requireMapAccess(USER_ID, MAP_ID, 'owner')).resolves.toBeUndefined();
  });

  it('throws NOT_FOUND when the map does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));
    await expect(requireMapAccess(USER_ID, MAP_ID, 'viewer')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws NOT_FOUND when a non-owner requests owner-level access', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([OTHER_MAP]));
    await expect(requireMapAccess(USER_ID, MAP_ID, 'owner')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // Should not make a second DB call (short-circuit after owner check fails)
    expect(db.select).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND when non-owner has no collaborator record', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([OTHER_MAP]))  // map found (not owner)
      .mockReturnValueOnce(drizzleChain([]));           // no collaborator
    await expect(requireMapAccess(USER_ID, MAP_ID, 'viewer')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('resolves when collaborator role exactly meets minRole (viewer → viewer)', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([OTHER_MAP]))
      .mockReturnValueOnce(drizzleChain([{ role: 'viewer' }]));
    await expect(requireMapAccess(USER_ID, MAP_ID, 'viewer')).resolves.toBeUndefined();
  });

  it('resolves when collaborator role exceeds minRole (editor → viewer)', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([OTHER_MAP]))
      .mockReturnValueOnce(drizzleChain([{ role: 'editor' }]));
    await expect(requireMapAccess(USER_ID, MAP_ID, 'viewer')).resolves.toBeUndefined();
  });

  it('resolves when commenter meets commenter requirement', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([OTHER_MAP]))
      .mockReturnValueOnce(drizzleChain([{ role: 'commenter' }]));
    await expect(requireMapAccess(USER_ID, MAP_ID, 'commenter')).resolves.toBeUndefined();
  });

  it('throws FORBIDDEN when viewer tries to perform an editor action', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([OTHER_MAP]))
      .mockReturnValueOnce(drizzleChain([{ role: 'viewer' }]));
    await expect(requireMapAccess(USER_ID, MAP_ID, 'editor')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('throws FORBIDDEN when commenter tries to perform an editor action', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([OTHER_MAP]))
      .mockReturnValueOnce(drizzleChain([{ role: 'commenter' }]));
    await expect(requireMapAccess(USER_ID, MAP_ID, 'editor')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('throws FORBIDDEN when viewer tries to comment (commenter required)', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([OTHER_MAP]))
      .mockReturnValueOnce(drizzleChain([{ role: 'viewer' }]));
    await expect(requireMapAccess(USER_ID, MAP_ID, 'commenter')).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
