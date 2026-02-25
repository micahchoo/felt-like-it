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
  },
  maps: { id: {}, userId: {} },
  mapEvents: { mapId: {}, userId: {}, action: {}, metadata: {}, createdAt: {}, id: {} },
}));

import { eventsRouter } from '../lib/server/trpc/routers/events.js';
import { db } from '$lib/server/db/index.js';
import { drizzleChain, mockContext } from './test-utils.js';

// --- Helpers ---

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
  return eventsRouter.createCaller(mockContext({ userId: USER_ID }));
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
    vi.mocked(db.insert).mockReturnValue(drizzleChain([{}]));

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
