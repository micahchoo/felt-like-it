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
  maps:     { id: {}, userId: {} },
  auditLog: { seq: {}, userId: {}, action: {}, entityType: {}, entityId: {}, mapId: {}, metadata: {}, prevHash: {}, chainHash: {}, createdAt: {} },
}));

import { auditLogRouter } from '../lib/server/trpc/routers/auditLog.js';
import { db } from '$lib/server/db/index.js';
import { computeChainHash, GENESIS_HASH } from '../lib/server/audit/index.js';
import { drizzleChain, mockContext } from './test-utils.js';

// --- Constants ---

const OWNER_ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID   = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const MOCK_MAP = { id: MAP_ID };

function makeCaller() {
  return auditLogRouter.createCaller(mockContext({ userId: OWNER_ID, userName: 'Owner', userEmail: 'owner@test.com' }));
}

// --- Tests ---

describe('auditLog.list', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns audit entries for a map the caller owns', async () => {
    const createdAt = new Date('2025-01-01T00:00:00Z');
    const entry = {
      seq: 1, userId: OWNER_ID, action: 'map.create', entityType: 'map',
      entityId: MAP_ID, mapId: MAP_ID, metadata: null,
      prevHash: GENESIS_HASH, chainHash: 'abc', createdAt,
    };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))  // ownership check
      .mockReturnValueOnce(drizzleChain([entry]));    // list

    const result = await makeCaller().list({ mapId: MAP_ID });

    expect(result).toHaveLength(1);
    expect(result[0]?.action).toBe('map.create');
  });

  it('returns empty array when no audit entries exist for the map', async () => {
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

describe('auditLog.verify', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns valid=true and entryCount=0 for an empty log', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    const result = await makeCaller().verify();

    expect(result).toEqual({ valid: true, entryCount: 0, firstInvalidSeq: null });
  });

  it('returns valid=true for a correctly chained single entry', async () => {
    const createdAt = new Date('2025-06-01T12:00:00.000Z');
    const chainHash = computeChainHash(
      { userId: OWNER_ID, action: 'map.create', entityType: 'map', entityId: MAP_ID, mapId: MAP_ID },
      GENESIS_HASH,
      createdAt
    );
    const entry = {
      seq: 1, userId: OWNER_ID, action: 'map.create', entityType: 'map',
      entityId: MAP_ID, mapId: MAP_ID, metadata: null,
      prevHash: GENESIS_HASH, chainHash, createdAt,
    };
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([entry]));

    const result = await makeCaller().verify();

    expect(result).toEqual({ valid: true, entryCount: 1, firstInvalidSeq: null });
  });

  it('returns valid=false when a stored chain_hash has been tampered with', async () => {
    const createdAt = new Date('2025-06-01T12:00:00.000Z');
    const entry = {
      seq: 1, userId: OWNER_ID, action: 'map.create', entityType: 'map',
      entityId: MAP_ID, mapId: MAP_ID, metadata: null,
      prevHash: GENESIS_HASH,
      chainHash: 'deadbeef'.repeat(8), // wrong hash
      createdAt,
    };
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([entry]));

    const result = await makeCaller().verify();

    expect(result.valid).toBe(false);
    expect(result.firstInvalidSeq).toBe(1);
  });

  it('returns valid=false when prev_hash does not match the preceding chain_hash', async () => {
    const t1 = new Date('2025-06-01T12:00:00.000Z');
    const t2 = new Date('2025-06-01T12:01:00.000Z');

    // First entry is valid
    const hash1 = computeChainHash(
      { userId: OWNER_ID, action: 'map.create', entityType: 'map', entityId: MAP_ID, mapId: MAP_ID },
      GENESIS_HASH, t1
    );
    // Second entry references a wrong prevHash
    const wrongPrev = 'cafebabe'.repeat(8);
    const hash2 = computeChainHash(
      { userId: OWNER_ID, action: 'map.delete', entityType: 'map', entityId: MAP_ID, mapId: MAP_ID },
      wrongPrev, t2
    );

    const entries = [
      { seq: 1, userId: OWNER_ID, action: 'map.create', entityType: 'map', entityId: MAP_ID, mapId: MAP_ID, metadata: null, prevHash: GENESIS_HASH, chainHash: hash1, createdAt: t1 },
      { seq: 2, userId: OWNER_ID, action: 'map.delete', entityType: 'map', entityId: MAP_ID, mapId: MAP_ID, metadata: null, prevHash: wrongPrev, chainHash: hash2, createdAt: t2 },
    ];
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain(entries));

    const result = await makeCaller().verify();

    expect(result.valid).toBe(false);
    expect(result.firstInvalidSeq).toBe(2);
  });
});

describe('computeChainHash', () => {
  it('produces a deterministic 64-char hex string', () => {
    const createdAt = new Date('2025-01-01T00:00:00.000Z');
    const hash = computeChainHash(
      { userId: 'user-id', action: 'map.create', entityType: 'map', entityId: 'entity-id', mapId: 'map-id' },
      GENESIS_HASH,
      createdAt
    );
    expect(hash).toMatch(/^[0-9a-f]{64}$/);

    // Deterministic — same inputs produce same output
    const hash2 = computeChainHash(
      { userId: 'user-id', action: 'map.create', entityType: 'map', entityId: 'entity-id', mapId: 'map-id' },
      GENESIS_HASH,
      createdAt
    );
    expect(hash).toBe(hash2);
  });

  it('produces different hashes for different prevHash values', () => {
    const createdAt = new Date('2025-01-01T00:00:00.000Z');
    const base = { userId: 'u', action: 'map.create' as const, entityType: 'map' };
    const h1 = computeChainHash(base, GENESIS_HASH, createdAt);
    const h2 = computeChainHash(base, 'a'.repeat(64), createdAt);
    expect(h1).not.toBe(h2);
  });
});
