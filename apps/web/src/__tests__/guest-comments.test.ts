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
  shares:   { mapId: {}, token: {} },
  maps:     { id: {}, userId: {} },
  comments: { id: {}, mapId: {}, userId: {}, body: {}, authorName: {}, resolved: {}, createdAt: {}, updatedAt: {} },
}));

import { commentsRouter } from '../lib/server/trpc/routers/comments.js';
import { db } from '$lib/server/db/index.js';
import { drizzleChain, publicContext } from './test-utils.js';

// --- Helpers ---

const SHARE_TOKEN = 'test-share-token-abc123';
const MAP_ID      = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const COMMENT_ID  = 'cccccccc-0000-0000-0000-cccccccccccc';

const MOCK_SHARE = { mapId: MAP_ID, token: SHARE_TOKEN };
const MOCK_COMMENT = {
  id: COMMENT_ID, mapId: MAP_ID, userId: null,
  authorName: 'Guest User', body: 'Hello from guest',
  resolved: false, createdAt: new Date(), updatedAt: new Date(),
};

/** Public caller — no auth context needed */
function makeCaller() {
  return commentsRouter.createCaller(publicContext());
}

// --- Tests ---

describe('comments.listForShare', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns comments for a valid share token', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_SHARE]))
      .mockReturnValueOnce(drizzleChain([MOCK_COMMENT]));

    const result = (await makeCaller().listForShare({ shareToken: SHARE_TOKEN })) as Array<{
      body: string;
      authorName: string;
    }>;
    expect(result).toHaveLength(1);
    expect(result[0]?.body).toBe('Hello from guest');
    expect(result[0]?.authorName).toBe('Guest User');
  });

  it('returns empty array when no comments exist', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_SHARE]))
      .mockReturnValueOnce(drizzleChain([]));

    const result = await makeCaller().listForShare({ shareToken: SHARE_TOKEN });
    expect(result).toHaveLength(0);
  });

  it('throws NOT_FOUND for an invalid share token', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().listForShare({ shareToken: 'bad-token' })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('comments.createForShare', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates a guest comment with null userId and provided authorName', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_SHARE]));
    vi.mocked(db.insert).mockReturnValue(drizzleChain([MOCK_COMMENT]));

    const result = await makeCaller().createForShare({
      shareToken: SHARE_TOKEN,
      authorName: 'Guest User',
      body: 'Hello from guest',
    });
    expect(result.body).toBe('Hello from guest');
    expect(result.authorName).toBe('Guest User');
    expect(result.userId).toBeNull();
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND for an invalid share token', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().createForShare({
        shareToken: 'bad-token',
        authorName: 'Guest',
        body: 'Hi',
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('trims and rejects blank authorName', async () => {
    await expect(
      makeCaller().createForShare({
        shareToken: SHARE_TOKEN,
        authorName: '   ',
        body: 'body',
      })
    ).rejects.toThrow();
  });

  it('trims and rejects blank body', async () => {
    await expect(
      makeCaller().createForShare({
        shareToken: SHARE_TOKEN,
        authorName: 'Guest',
        body: '   ',
      })
    ).rejects.toThrow();
  });
});
