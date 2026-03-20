import { describe, it, expect } from 'vitest';
import { encodeCursor, decodeCursor, parsePaginationParams } from '$lib/server/api/pagination.js';
import { toLayerSummary, toLayerDetail } from '$lib/server/api/serializers.js';
import { mapLinks, layerLinks, listLinks } from '$lib/server/api/links.js';

describe('cursor pagination', () => {
  it('round-trips a cursor', () => {
    const date = new Date('2026-03-19T12:00:00Z');
    const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    const cursor = encodeCursor(date, id);
    const decoded = decodeCursor(cursor);
    expect(decoded).not.toBeNull();
    expect(decoded!.createdAt.toISOString()).toBe(date.toISOString());
    expect(decoded!.id).toBe(id);
  });

  it('returns null for invalid cursor', () => {
    expect(decodeCursor('not-valid')).toBeNull();
    expect(decodeCursor('')).toBeNull();
  });

  it('returns null for malformed base64 with missing id', () => {
    const cursor = Buffer.from('2026-01-01T00:00:00.000Z|').toString('base64url');
    expect(decodeCursor(cursor)).toBeNull();
  });
});

describe('parsePaginationParams', () => {
  it('defaults to limit 20 with no cursor', () => {
    const url = new URL('http://localhost/api/v1/maps');
    const { cursor, limit } = parsePaginationParams(url);
    expect(cursor).toBeNull();
    expect(limit).toBe(20);
  });

  it('clamps limit to 100', () => {
    const url = new URL('http://localhost/api/v1/maps?limit=500');
    const { limit } = parsePaginationParams(url);
    expect(limit).toBe(100);
  });

  it('treats limit=0 as default (0 is falsy, falls back to 20)', () => {
    const url = new URL('http://localhost/api/v1/maps?limit=0');
    const { limit } = parsePaginationParams(url);
    expect(limit).toBe(20);
  });
});

describe('toLayerSummary serializer', () => {
  it('maps snake_case row', () => {
    const row = { id: 'l1', map_id: 'm1', name: 'Parks', type: 'polygon', feature_count: 42, visible: true, z_index: 1 };
    const result = toLayerSummary(row);
    expect(result.mapId).toBe('m1');
    expect(result.featureCount).toBe(42);
    expect(result.zIndex).toBe(1);
    expect(result).not.toHaveProperty('style');
  });
});

describe('toLayerDetail serializer', () => {
  it('includes style and sourceFileName', () => {
    const row = { id: 'l1', map_id: 'm1', name: 'Parks', type: 'polygon', feature_count: 42, visible: true, z_index: 1, style: { version: 1 }, source_file_name: 'parks.geojson' };
    const result = toLayerDetail(row);
    expect(result.style).toEqual({ version: 1 });
    expect(result.sourceFileName).toBe('parks.geojson');
  });
});

describe('links helpers', () => {
  it('mapLinks generates all expected links', () => {
    const links = mapLinks('m1');
    expect(links.self).toBe('/api/v1/maps/m1');
    expect(links.layers).toContain('m1');
    expect(links.annotations).toContain('m1');
    expect(links.comments).toContain('m1');
  });

  it('layerLinks includes geojson, features, tiles', () => {
    const links = layerLinks('m1', 'l1');
    expect(links.geojson).toContain('geojson');
    expect(links.features).toContain('features');
    expect(links.tiles).toContain('tiles');
  });

  it('listLinks adds next only when cursor exists', () => {
    const withCursor = listLinks('/api/v1/maps', 'abc123');
    expect(withCursor.next).toContain('cursor=abc123');

    const withoutCursor = listLinks('/api/v1/maps', null);
    expect(withoutCursor).not.toHaveProperty('next');
  });
});
