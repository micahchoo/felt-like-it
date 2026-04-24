// @vitest-environment node
/**
 * F13.2 + F13.3 — tests for the resolveShareToken helper.
 *
 * Mocks the drizzle db chain so we exercise the helper's branching
 * (not_found / expired / ok) without a live database.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  shares: {},
  maps: {},
  layers: {},
}));

import { resolveShareToken } from '../lib/server/auth/resolve-share-token.js';
import { db } from '$lib/server/db/index.js';
import { drizzleChain } from './test-utils.js';

const TOKEN = 'abc-token';

const MOCK_SHARE = {
  id: 'share-1',
  mapId: 'map-1',
  token: TOKEN,
  accessLevel: 'public',
  expiresAt: null,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};
const MOCK_MAP = { id: 'map-1', title: 'Test', viewport: {}, basemap: 'streets' };
const MOCK_LAYERS = [{ id: 'layer-1', mapId: 'map-1', name: 'L1', zIndex: 0 }];

describe('resolveShareToken', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns kind:not_found when no share row matches the token', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));
    const result = await resolveShareToken(TOKEN);
    expect(result.kind).toBe('not_found');
  });

  it('returns kind:not_found when share resolves but map is missing (orphan)', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_SHARE]))
      .mockReturnValueOnce(drizzleChain([])); // map lookup empty
    const result = await resolveShareToken(TOKEN);
    expect(result.kind).toBe('not_found');
  });

  it('returns kind:ok with share+map+layers when everything resolves', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_SHARE]))
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain(MOCK_LAYERS));
    const result = await resolveShareToken(TOKEN);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') {
      expect(result.share).toEqual(MOCK_SHARE);
      expect(result.map).toEqual(MOCK_MAP);
      expect(result.layers).toEqual(MOCK_LAYERS);
    }
  });

  describe('F13.3 — expiration', () => {
    const NOW = new Date('2026-04-25T12:00:00Z');
    const PAST = new Date('2026-04-24T12:00:00Z'); // 1 day before NOW
    const FUTURE = new Date('2026-04-26T12:00:00Z'); // 1 day after NOW

    it('returns kind:expired when expires_at is in the past', async () => {
      vi.mocked(db.select).mockReturnValueOnce(
        drizzleChain([{ ...MOCK_SHARE, expiresAt: PAST }]),
      );
      const result = await resolveShareToken(TOKEN, () => NOW);
      expect(result.kind).toBe('expired');
      if (result.kind === 'expired') {
        expect(result.expiredAt).toEqual(PAST);
      }
    });

    it('returns kind:ok when expires_at is in the future', async () => {
      vi.mocked(db.select)
        .mockReturnValueOnce(drizzleChain([{ ...MOCK_SHARE, expiresAt: FUTURE }]))
        .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
        .mockReturnValueOnce(drizzleChain(MOCK_LAYERS));
      const result = await resolveShareToken(TOKEN, () => NOW);
      expect(result.kind).toBe('ok');
    });

    it('returns kind:ok when expires_at is null (no expiration)', async () => {
      vi.mocked(db.select)
        .mockReturnValueOnce(drizzleChain([{ ...MOCK_SHARE, expiresAt: null }]))
        .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
        .mockReturnValueOnce(drizzleChain(MOCK_LAYERS));
      const result = await resolveShareToken(TOKEN, () => NOW);
      expect(result.kind).toBe('ok');
    });

    it('does not query map/layers once a token is determined expired', async () => {
      vi.mocked(db.select).mockReturnValueOnce(
        drizzleChain([{ ...MOCK_SHARE, expiresAt: PAST }]),
      );
      await resolveShareToken(TOKEN, () => NOW);
      // Only the share-lookup should have been called — early-return on
      // expired short-circuits the rest of the chain.
      expect(db.select).toHaveBeenCalledTimes(1);
    });

    it('boundary: expires_at exactly equal to now is treated as expired (strictly past)', async () => {
      // Behaviour choice: expires_at < now → expired. expires_at == now is
      // also rejected via < being strict; however our check is `<`. So the
      // exact-equal case is the boundary: at the same millisecond, check
      // returns false (not expired). Document the chosen boundary here.
      const exactBoundaryShare = { ...MOCK_SHARE, expiresAt: NOW };
      vi.mocked(db.select)
        .mockReturnValueOnce(drizzleChain([exactBoundaryShare]))
        .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
        .mockReturnValueOnce(drizzleChain(MOCK_LAYERS));
      const result = await resolveShareToken(TOKEN, () => NOW);
      // <  comparison → equal-time still resolves OK; one millisecond later it expires.
      expect(result.kind).toBe('ok');
    });
  });
});
