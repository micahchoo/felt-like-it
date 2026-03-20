import { describe, it, expect } from 'vitest';
import { toErrorResponse } from '../routes/api/v1/errors.js';
import { envelope, requireScope, assertMapAccess } from '../routes/api/v1/middleware.js';
import { toMapSummary, toMapDetail } from '$lib/server/api/serializers.js';

describe('toErrorResponse', () => {
  it('returns correct status and error shape for UNAUTHORIZED', async () => {
    const res = toErrorResponse('UNAUTHORIZED');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.status).toBe(401);
  });

  it('returns 404 for MAP_NOT_FOUND with custom message', async () => {
    const res = toErrorResponse('MAP_NOT_FOUND', 'No such map');
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toBe('No such map');
  });

  it('defaults message to code when not provided', async () => {
    const res = toErrorResponse('FORBIDDEN');
    const body = await res.json();
    expect(body.error.message).toBe('FORBIDDEN');
  });
});

describe('envelope', () => {
  it('wraps data with meta and links, defaults to empty objects', () => {
    const result = envelope([{ id: '1' }]);
    expect(result).toEqual({ data: [{ id: '1' }], meta: {}, links: {} });
  });

  it('includes meta and links when provided', () => {
    const result = envelope([], { totalCount: 5, limit: 20, nextCursor: null }, { self: '/api/v1/maps' });
    expect(result.meta.totalCount).toBe(5);
    expect(result.links.self).toBe('/api/v1/maps');
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

describe('requireScope', () => {
  it('rejects read-write when scope is read-only', () => {
    expect(() => requireScope({ userId: 'u1', scope: 'read', mapScope: null }, 'read-write')).toThrow();
  });

  it('allows read when scope is read', () => {
    expect(() => requireScope({ userId: 'u1', scope: 'read', mapScope: null }, 'read')).not.toThrow();
  });
});

describe('toMapSummary serializer', () => {
  it('maps snake_case DB row to camelCase API shape', () => {
    const row = { id: 'x', title: 'T', description: 'D', basemap: 'osm', created_at: new Date('2026-01-01'), updated_at: new Date('2026-01-02') };
    const result = toMapSummary(row);
    expect(result.id).toBe('x');
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result).not.toHaveProperty('viewport');
  });
});

describe('toMapDetail serializer', () => {
  it('includes viewport', () => {
    const row = { id: 'x', title: 'T', description: 'D', basemap: 'osm', viewport: { center: [0, 0], zoom: 5 }, created_at: new Date(), updated_at: new Date() };
    const result = toMapDetail(row);
    expect(result.viewport).toEqual({ center: [0, 0], zoom: 5 });
  });
});
