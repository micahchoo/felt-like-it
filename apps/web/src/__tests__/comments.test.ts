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
  maps:     { id: {}, userId: {} },
  comments: { id: {}, mapId: {}, userId: {}, body: {}, authorName: {}, resolved: {}, createdAt: {}, updatedAt: {} },
}));

import { commentsRouter } from '../lib/server/trpc/routers/comments.js';
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
  return commentsRouter.createCaller({
    user: { id: USER_ID, name: 'Test User' } as unknown as User,
    session: { id: 'sess', userId: USER_ID, expiresAt: new Date(Date.now() + 3600_000), fresh: false },
    event: {} as RequestEvent,
  });
}

// --- Tests ---

describe('comments.list', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns comments in chronological order', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))        // ownership
      .mockReturnValueOnce(drizzleChain([MOCK_COMMENT]));   // comments

    const result = await makeCaller().list({ mapId: MAP_ID });
    expect(result).toHaveLength(1);
    expect(result[0]?.body).toBe('Hello world');
  });

  it('returns empty array when no comments exist', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([]));

    const result = await makeCaller().list({ mapId: MAP_ID });
    expect(result).toHaveLength(0);
  });

  it('throws NOT_FOUND when map does not belong to caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().list({ mapId: MAP_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('comments.create', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates and returns the new comment', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.insert).mockReturnValue(
      drizzleChain([MOCK_COMMENT]) as unknown as ReturnType<typeof db.insert>
    );

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
});

describe('comments.delete', () => {
  beforeEach(() => vi.resetAllMocks());

  it('deletes own comment and returns { deleted: true }', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([{ id: COMMENT_ID }]));
    vi.mocked(db.delete).mockReturnValue(drizzleChain(undefined) as unknown as ReturnType<typeof db.delete>);

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
    vi.mocked(db.update).mockReturnValue(
      drizzleChain([updatedComment]) as unknown as ReturnType<typeof db.update>
    );

    const result = await makeCaller().resolve({ id: COMMENT_ID });
    expect(result.resolved).toBe(true);
  });

  it('throws NOT_FOUND when comment does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().resolve({ id: COMMENT_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws FORBIDDEN when caller does not own the map', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([{ id: COMMENT_ID, mapId: MAP_ID, resolved: false }]))
      .mockReturnValueOnce(drizzleChain([])); // map ownership check → empty

    await expect(makeCaller().resolve({ id: COMMENT_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});
