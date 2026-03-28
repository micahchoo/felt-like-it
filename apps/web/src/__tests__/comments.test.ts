// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Narrow the paginated branch of comments.list / listForShare return type. */
type Paginated<T> = { items: T[]; nextCursor: string | undefined };

// --- Module mocks ---

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select:  vi.fn(),
    insert:  vi.fn(),
    update:  vi.fn(),
    delete:  vi.fn(),
    execute: vi.fn(),
  },
  maps:             { id: {}, userId: {} },
  comments:         { id: {}, mapId: {}, userId: {}, body: {}, authorName: {}, resolved: {}, createdAt: {}, updatedAt: {} },
  mapCollaborators: { mapId: {}, userId: {}, role: {} },
  shares:           { token: {}, mapId: {} },
}));

import { commentsRouter } from '../lib/server/trpc/routers/comments.js';
import { db } from '$lib/server/db/index.js';
import { drizzleChain, mockContext, publicContext } from './test-utils.js';

// --- Helpers ---

const USER_ID    = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID     = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const COMMENT_ID = 'cccccccc-0000-0000-0000-cccccccccccc';

const MOCK_MAP     = { id: MAP_ID, userId: USER_ID };
const MOCK_COMMENT = {
  id: COMMENT_ID, mapId: MAP_ID, userId: USER_ID,
  authorName: 'Test User', body: 'Hello world',
  resolved: false, createdAt: new Date(), updatedAt: new Date(),
};

function makeCaller() {
  return commentsRouter.createCaller(mockContext({ userId: USER_ID }));
}

// --- Tests ---

describe('comments.list', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns comments in chronological order', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))        // ownership
      .mockReturnValueOnce(drizzleChain([MOCK_COMMENT]));   // comments

    const result = await makeCaller().list({ mapId: MAP_ID });
    expect(Array.isArray(result)).toBe(true);
    const rows = result as Array<{ body: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe('Hello world');
  });

  it('returns empty array when no comments exist', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([]));

    const result = await makeCaller().list({ mapId: MAP_ID });
    expect(Array.isArray(result)).toBe(true);
    expect(result as unknown[]).toHaveLength(0);
  });

  it('throws NOT_FOUND when map does not belong to caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().list({ mapId: MAP_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('resolves for a collaborator with viewer role', async () => {
    const otherMap = { id: MAP_ID, userId: 'other-user' };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([otherMap]))              // maps -> not owner
      .mockReturnValueOnce(drizzleChain([{ role: 'viewer' }]))    // mapCollaborators
      .mockReturnValueOnce(drizzleChain([MOCK_COMMENT]));          // comments

    const result = await makeCaller().list({ mapId: MAP_ID });
    expect(Array.isArray(result)).toBe(true);
    const rows = result as Array<{ body: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe('Hello world');
  });
});

describe('comments.create', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates and returns the new comment', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.insert).mockReturnValue(drizzleChain([MOCK_COMMENT]));

    const result = await makeCaller().create({ mapId: MAP_ID, body: 'Hello world' });
    expect(result.body).toBe('Hello world');
    expect(result.authorName).toBe('Test User');
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND when map does not belong to caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().create({ mapId: MAP_ID, body: 'Hi' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('trims and rejects empty body', async () => {
    await expect(
      makeCaller().create({ mapId: MAP_ID, body: '   ' })
    ).rejects.toThrow(); // Zod min(1) after trim
  });

  it('resolves for a collaborator with commenter role', async () => {
    const otherMap = { id: MAP_ID, userId: 'other-user' };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([otherMap]))                 // maps -> not owner
      .mockReturnValueOnce(drizzleChain([{ role: 'commenter' }]));   // mapCollaborators
    vi.mocked(db.insert).mockReturnValue(drizzleChain([MOCK_COMMENT]));

    const result = await makeCaller().create({ mapId: MAP_ID, body: 'Hello world' });
    expect(result.body).toBe('Hello world');
    expect(db.insert).toHaveBeenCalledOnce();
  });
});

describe('comments.delete', () => {
  beforeEach(() => vi.resetAllMocks());

  it('deletes own comment and returns { deleted: true }', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([{ id: COMMENT_ID }]));
    vi.mocked(db.delete).mockReturnValue(drizzleChain(undefined));

    const result = await makeCaller().delete({ id: COMMENT_ID });
    expect(result).toEqual({ deleted: true });
  });

  it('throws NOT_FOUND when comment does not belong to caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().delete({ id: COMMENT_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('comments.resolve', () => {
  beforeEach(() => vi.resetAllMocks());

  it('toggles resolved and returns updated comment', async () => {
    const updatedComment = { ...MOCK_COMMENT, resolved: true };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ id: COMMENT_ID, mapId: MAP_ID, resolved: false }]))
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.update).mockReturnValue(drizzleChain([updatedComment]));

    const result = await makeCaller().resolve({ id: COMMENT_ID });
    expect(result.resolved).toBe(true);
  });

  it('throws NOT_FOUND when comment does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().resolve({ id: COMMENT_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws NOT_FOUND when caller does not own the map', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ id: COMMENT_ID, mapId: MAP_ID, resolved: false }]))
      .mockReturnValueOnce(drizzleChain([])); // map ownership check -> empty

    await expect(makeCaller().resolve({ id: COMMENT_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

// --- Pagination ---

const SHARE_TOKEN = 'valid-share-token';

function makeComment(index: number) {
  return {
    id: `cccccccc-0000-0000-0000-${String(index).padStart(12, '0')}`,
    mapId: MAP_ID,
    userId: USER_ID,
    authorName: 'Test User',
    body: `Comment ${index}`,
    resolved: false,
    createdAt: new Date(Date.now() - index * 1000),
    updatedAt: new Date(Date.now() - index * 1000),
  };
}

function makePublicCaller() {
  return commentsRouter.createCaller(publicContext());
}

describe('comments.list pagination', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns flat array when no limit is provided (backward compat)', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))        // ownership
      .mockReturnValueOnce(drizzleChain([MOCK_COMMENT]));   // comments

    const result = await makeCaller().list({ mapId: MAP_ID });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('returns paginated response with nextCursor when limit is provided and more exist', async () => {
    const threeComments = [makeComment(1), makeComment(2), makeComment(3)];
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))            // ownership
      .mockReturnValueOnce(drizzleChain(threeComments));         // comments (limit+1 = 3)

    const result = await makeCaller().list({ mapId: MAP_ID, limit: 2 }) as Paginated<unknown>;
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('nextCursor');
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe(threeComments[1]!.id);
  });

  it('returns paginated response without nextCursor when all results fit', async () => {
    const twoComments = [makeComment(1), makeComment(2)];
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain(twoComments));

    const result = await makeCaller().list({ mapId: MAP_ID, limit: 5 }) as Paginated<unknown>;
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeUndefined();
  });

  it('accepts a cursor parameter without error', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([makeComment(3)]));

    const result = await makeCaller().list({
      mapId: MAP_ID,
      limit: 2,
      cursor: makeComment(2).id,
    }) as Paginated<unknown>;
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBeUndefined();
  });
});

describe('comments.listForShare pagination', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns flat array when no limit is provided (backward compat)', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ mapId: MAP_ID }]))   // share lookup
      .mockReturnValueOnce(drizzleChain([MOCK_COMMENT]));        // comments

    const result = await makePublicCaller().listForShare({ shareToken: SHARE_TOKEN });
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it('returns paginated response with nextCursor when limit is provided', async () => {
    const threeComments = [makeComment(1), makeComment(2), makeComment(3)];
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ mapId: MAP_ID }]))   // share lookup
      .mockReturnValueOnce(drizzleChain(threeComments));         // comments (limit+1)

    const result = await makePublicCaller().listForShare({ shareToken: SHARE_TOKEN, limit: 2 }) as Paginated<unknown>;
    expect(result).toHaveProperty('items');
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBe(threeComments[1]!.id);
  });

  it('throws NOT_FOUND for invalid share token', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makePublicCaller().listForShare({ shareToken: 'bad-token', limit: 10 })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
