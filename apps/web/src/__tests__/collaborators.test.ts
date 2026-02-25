// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Module mocks ---

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select:      vi.fn(),
    insert:      vi.fn(),
    update:      vi.fn(),
    delete:      vi.fn(),
    execute:     vi.fn(),
    transaction: vi.fn(),
  },
  maps:             { id: {}, userId: {} },
  users:            { id: {}, email: {}, name: {} },
  mapCollaborators: { id: {}, mapId: {}, userId: {}, role: {}, invitedBy: {}, createdAt: {} },
}));

import { collaboratorsRouter } from '../lib/server/trpc/routers/collaborators.js';
import { db } from '$lib/server/db/index.js';
import { drizzleChain, mockContext } from './test-utils.js';

// --- Helpers ---

const OWNER_ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const OTHER_ID = 'dddddddd-0000-0000-0000-dddddddddddd';
const MAP_ID   = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const COLLAB_ID = 'eeeeeeee-0000-0000-0000-eeeeeeeeeeee';

const MOCK_MAP   = { id: MAP_ID };
const MOCK_USER  = { id: OTHER_ID, name: 'Other User' };
const MOCK_COLLAB = {
  id: COLLAB_ID, mapId: MAP_ID, userId: OTHER_ID,
  role: 'viewer', invitedBy: OWNER_ID, createdAt: new Date(),
  email: 'other@test.com', name: 'Other User',
};

function makeCaller() {
  return collaboratorsRouter.createCaller(mockContext({ userId: OWNER_ID, userName: 'Owner' }));
}

// --- Tests ---

describe('collaborators.list', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns collaborators with user details', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([MOCK_COLLAB]));

    const result = await makeCaller().list({ mapId: MAP_ID });
    expect(result).toHaveLength(1);
    expect(result[0]?.email).toBe('other@test.com');
    expect(result[0]?.role).toBe('viewer');
  });

  it('returns empty array when no collaborators', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([]));

    const result = await makeCaller().list({ mapId: MAP_ID });
    expect(result).toHaveLength(0);
  });

  it('throws NOT_FOUND when caller does not own the map', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().list({ mapId: MAP_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('collaborators.invite', () => {
  beforeEach(() => vi.resetAllMocks());

  it('invites a user and returns the collaborator record', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))    // ownership
      .mockReturnValueOnce(drizzleChain([MOCK_USER]))   // find by email
      .mockReturnValueOnce(drizzleChain([]));            // not already invited
    vi.mocked(db.insert).mockReturnValue(drizzleChain([MOCK_COLLAB]));

    const result = await makeCaller().invite({ mapId: MAP_ID, email: 'other@test.com', role: 'viewer' });
    expect(result.userId).toBe(OTHER_ID);
    expect(result.role).toBe('viewer');
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND when map does not belong to caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().invite({ mapId: MAP_ID, email: 'other@test.com', role: 'viewer' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND when email is not registered', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([])); // no user found

    await expect(
      makeCaller().invite({ mapId: MAP_ID, email: 'nobody@test.com', role: 'viewer' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws BAD_REQUEST when inviting self', async () => {
    const selfUser = { id: OWNER_ID, name: 'Owner' };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([selfUser]));

    await expect(
      makeCaller().invite({ mapId: MAP_ID, email: 'owner@test.com', role: 'viewer' })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });

  it('throws CONFLICT when user is already a collaborator', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([MOCK_USER]))
      .mockReturnValueOnce(drizzleChain([MOCK_COLLAB])); // already exists

    await expect(
      makeCaller().invite({ mapId: MAP_ID, email: 'other@test.com', role: 'editor' })
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('collaborators.remove', () => {
  beforeEach(() => vi.resetAllMocks());

  it('removes a collaborator and returns { removed: true }', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.delete).mockReturnValue(drizzleChain(undefined));

    const result = await makeCaller().remove({ mapId: MAP_ID, userId: OTHER_ID });
    expect(result).toEqual({ removed: true });
  });

  it('throws NOT_FOUND when caller does not own the map', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().remove({ mapId: MAP_ID, userId: OTHER_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('collaborators.updateRole', () => {
  beforeEach(() => vi.resetAllMocks());

  it('updates the collaborator role and returns the updated record', async () => {
    const updated = { ...MOCK_COLLAB, role: 'editor' };
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.update).mockReturnValue(drizzleChain([updated]));

    const result = await makeCaller().updateRole({ mapId: MAP_ID, userId: OTHER_ID, role: 'editor' });
    expect(result.role).toBe('editor');
  });

  it('throws NOT_FOUND when caller does not own the map', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().updateRole({ mapId: MAP_ID, userId: OTHER_ID, role: 'editor' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws NOT_FOUND when collaborator does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.update).mockReturnValue(drizzleChain([]));

    await expect(
      makeCaller().updateRole({ mapId: MAP_ID, userId: OTHER_ID, role: 'editor' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
