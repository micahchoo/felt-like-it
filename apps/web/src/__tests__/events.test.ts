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
  maps: { id: {}, userId: {} },
  mapEvents: { mapId: {}, userId: {}, action: {}, metadata: {}, createdAt: {}, id: {} },
}));

import { eventsRouter } from '../lib/server/trpc/routers/events.js';
import { db } from '$lib/server/db/index.js';

// --- Helpers ---

/** Drizzle-compatible chain mock with limit() support for events.list. */
function drizzleChain<T>(value: T) {
  const c: Record<string, unknown> = {
    then: (res: (v: T) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(value).then(res, rej),
  };
  for (const m of ['from', 'where', 'orderBy', 'groupBy', 'set', 'limit']) {
    c[m] = vi.fn(() => c);
  }
  c['values']    = vi.fn(() => ({ returning: vi.fn().mockResolvedValue(value) }));
  c['returning'] = vi.fn().mockResolvedValue(value);
  return c as unknown as ReturnType<typeof db.select>;
}

const USER_ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID  = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';

const MOCK_MAP = { id: MAP_ID, userId: USER_ID };

const MOCK_EVENT = {
  id: 'cccccccc-0000-0000-0000-cccccccccccc',
  mapId: MAP_ID,
  userId: USER_ID,
  action: 'layer.imported',
  metadata: { name: 'Parks' },
  createdAt: new Date(),
};

function makeCaller() {
  return eventsRouter.createCaller({
    user: { id: USER_ID } as unknown as User,
    session: { id: 'sess', userId: USER_ID, expiresAt: new Date(Date.now() + 3600_000), fresh: false },
    event: {} as RequestEvent,
  });
}

// --- Tests ---

describe('events.list', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns events for an owned map, newest first', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))      // ownership check
      .mockReturnValueOnce(drizzleChain([MOCK_EVENT]));   // events query

    const result = await makeCaller().list({ mapId: MAP_ID });

    expect(result).toHaveLength(1);
    expect(result[0]?.action).toBe('layer.imported');
    expect(result[0]?.mapId).toBe(MAP_ID);
  });

  it('returns an empty array when there are no events', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))  // ownership
      .mockReturnValueOnce(drizzleChain([]));         // no events

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

describe('events.log', () => {
  beforeEach(() => vi.resetAllMocks());

  it('inserts an event and returns { logged: true }', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.insert).mockReturnValue(drizzleChain([{}]) as unknown as ReturnType<typeof db.insert>);

    const result = await makeCaller().log({
      mapId: MAP_ID,
      action: 'layer.imported',
      metadata: { name: 'Parks' },
    });

    expect(result).toEqual({ logged: true });
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND when map does not belong to caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().log({ mapId: MAP_ID, action: 'layer.imported' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
