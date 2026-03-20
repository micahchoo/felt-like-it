import { describe, it, expect, vi, beforeEach } from 'vitest';

// We'll test resolveAuth by mocking the DB layer
vi.mock('$lib/server/db/index.js', () => ({
  db: { select: vi.fn(), execute: vi.fn(), update: vi.fn() },
  apiKeys: { id: 'id', userId: 'user_id', keyHash: 'key_hash', scope: 'scope' },
  shares: { id: 'id', mapId: 'map_id', token: 'token' },
  users: { id: 'id', email: 'email', name: 'name', isAdmin: 'is_admin', disabledAt: 'disabled_at' },
}));

import { resolveAuth, envelope, requireScope, assertMapAccess } from '../routes/api/v1/middleware.js';

function mockEvent(headers: Record<string, string> = {}, params: Record<string, string> = {}): any {
  return {
    request: { headers: new Headers(headers) },
    url: new URL('http://localhost/api/v1/maps'),
    params,
  };
}

describe('resolveAuth', () => {
  it('returns null auth when no credentials provided', async () => {
    const result = await resolveAuth(mockEvent());
    expect(result).toBeNull();
  });
});

describe('envelope', () => {
  it('wraps data with meta and links', () => {
    const body = envelope({ id: '1' }, { totalCount: 1 }, { self: '/test' });
    expect(body).toEqual({
      data: { id: '1' },
      meta: { totalCount: 1 },
      links: { self: '/test' },
    });
  });

  it('defaults meta and links to empty objects', () => {
    const body = envelope({ id: '1' });
    expect(body).toEqual({ data: { id: '1' }, meta: {}, links: {} });
  });
});

describe('requireScope', () => {
  it('does not throw for read when scope is read', () => {
    expect(() => requireScope({ userId: 'u1', scope: 'read', mapScope: null }, 'read')).not.toThrow();
  });

  it('throws for read-write when scope is read', () => {
    expect(() => requireScope({ userId: 'u1', scope: 'read', mapScope: null }, 'read-write')).toThrow();
  });

  it('allows read-write when scope is read-write', () => {
    expect(() => requireScope({ userId: 'u1', scope: 'read-write', mapScope: null }, 'read-write')).not.toThrow();
  });
});

describe('assertMapAccess', () => {
  it('throws when mapScope does not match', () => {
    expect(() => assertMapAccess({ userId: null, scope: 'read', mapScope: 'map-1' }, 'map-2')).toThrow();
  });

  it('passes when mapScope matches', () => {
    expect(() => assertMapAccess({ userId: null, scope: 'read', mapScope: 'map-1' }, 'map-1')).not.toThrow();
  });

  it('passes when mapScope is null (API key auth)', () => {
    expect(() => assertMapAccess({ userId: 'u1', scope: 'read', mapScope: null }, 'any-map')).not.toThrow();
  });
});
