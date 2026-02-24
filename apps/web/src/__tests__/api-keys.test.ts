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
  apiKeys: {
    id: {},
    userId: {},
    name: {},
    keyHash: {},
    prefix: {},
    lastUsedAt: {},
    createdAt: {},
  },
}));

import { apiKeysRouter } from '../lib/server/trpc/routers/apiKeys.js';
import { db } from '$lib/server/db/index.js';

// --- Helpers ---

function drizzleChain<T>(value: T) {
  const c: Record<string, unknown> = {
    then: (res: (v: T) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(value).then(res, rej),
  };
  for (const m of ['from', 'where', 'orderBy', 'set', 'limit']) {
    c[m] = vi.fn(() => c);
  }
  c['values']    = vi.fn(() => ({ returning: vi.fn().mockResolvedValue(value) }));
  c['returning'] = vi.fn().mockResolvedValue(value);
  return c as unknown as ReturnType<typeof db.select>;
}

// --- Constants ---

const USER_ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const KEY_ID  = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';

const MOCK_KEY_RECORD = {
  id:         KEY_ID,
  name:       'Test Key',
  prefix:     'flk_abcde123',
  lastUsedAt: null,
  createdAt:  new Date('2025-01-01T00:00:00Z'),
};

function makeCaller() {
  return apiKeysRouter.createCaller({
    user:    { id: USER_ID, name: 'Test User', email: 'test@test.com' } as unknown as User,
    session: { id: 'sess', userId: USER_ID, expiresAt: new Date(Date.now() + 3_600_000), fresh: false },
    event:   {} as RequestEvent,
  });
}

// --- Tests ---

describe('apiKeys.list', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns keys for the current user', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_KEY_RECORD]));

    const result = await makeCaller().list();

    expect(result).toHaveLength(1);
    expect(result[0]?.name).toBe('Test Key');
    expect(result[0]?.prefix).toBe('flk_abcde123');
  });

  it('returns empty array when the user has no keys', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    const result = await makeCaller().list();

    expect(result).toHaveLength(0);
  });
});

describe('apiKeys.create', () => {
  beforeEach(() => vi.resetAllMocks());

  it('generates and stores an API key, returning the plaintext key once', async () => {
    const createdRecord = { id: KEY_ID, name: 'My Key', prefix: 'flk_abc12345', createdAt: new Date() };
    vi.mocked(db.insert).mockReturnValue(
      drizzleChain([createdRecord]) as unknown as ReturnType<typeof db.insert>
    );

    const result = await makeCaller().create({ name: 'My Key' });

    // Plaintext key is returned and has the expected format
    expect(result.key).toMatch(/^flk_[0-9a-f]{64}$/);
    expect(result.record.name).toBe('My Key');
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('key hash stored is not the raw key', async () => {
    const insertSpy = vi.mocked(db.insert).mockReturnValue(
      drizzleChain([{ id: KEY_ID, name: 'K', prefix: 'flk_x', createdAt: new Date() }]) as unknown as ReturnType<typeof db.insert>
    );

    const result = await makeCaller().create({ name: 'K' });

    // The values passed to insert should include keyHash ≠ rawKey
    const valuesCall = (insertSpy.mock.results[0]?.value as { values: ReturnType<typeof vi.fn> })?.values;
    const insertedValues = valuesCall?.mock.calls[0]?.[0] as { keyHash: string } | undefined;
    if (insertedValues) {
      expect(insertedValues.keyHash).not.toBe(result.key);
      expect(insertedValues.keyHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    }
  });

  it('throws INTERNAL_SERVER_ERROR when insert returns empty', async () => {
    vi.mocked(db.insert).mockReturnValue(
      drizzleChain([]) as unknown as ReturnType<typeof db.insert>
    );

    await expect(makeCaller().create({ name: 'My Key' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });
});

describe('apiKeys.revoke', () => {
  beforeEach(() => vi.resetAllMocks());

  it('revokes a key owned by the caller and returns { revoked: true }', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([{ id: KEY_ID }]));
    vi.mocked(db.delete).mockReturnValue(
      drizzleChain(undefined) as unknown as ReturnType<typeof db.delete>
    );

    const result = await makeCaller().revoke({ id: KEY_ID });

    expect(result).toEqual({ revoked: true });
    expect(db.delete).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND when the key does not exist or belong to the caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().revoke({ id: KEY_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });

    expect(db.delete).not.toHaveBeenCalled();
  });
});
