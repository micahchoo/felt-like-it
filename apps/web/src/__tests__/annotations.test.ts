// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import type { User } from 'lucia';

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select:  vi.fn(),
    insert:  vi.fn(),
    update:  vi.fn(),
    delete:  vi.fn(),
    execute: vi.fn(),
  },
  maps:        { id: {}, userId: {} },
  annotations: { id: {}, mapId: {}, userId: {}, authorName: {}, anchorPoint: {}, content: {}, createdAt: {}, updatedAt: {} },
}));

import { annotationsRouter } from '../lib/server/trpc/routers/annotations.js';
import { db } from '$lib/server/db/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Minimal drizzle chain mock — thenable so await works; all builder methods
 * return the same chain object. Mirrors the pattern from comments.test.ts.
 */
function drizzleChain<T>(value: T) {
  const c: Record<string, unknown> = {
    then: (res: (v: T) => unknown, rej: (e: unknown) => unknown) =>
      Promise.resolve(value).then(res, rej),
  };
  for (const m of ['from', 'where', 'orderBy', 'set', 'innerJoin']) {
    c[m] = vi.fn(() => c);
  }
  c['values']    = vi.fn(() => ({ returning: vi.fn().mockResolvedValue(value) }));
  c['returning'] = vi.fn().mockResolvedValue(value);
  return c as unknown as ReturnType<typeof db.select>;
}

// Type helper so TypeScript accepts vi.mocked(db.execute).mockResolvedValueOnce(...)
type DbExecuteResult = Awaited<ReturnType<typeof db.execute>>;

const USER_ID   = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID    = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const ANNOT_ID  = 'cccccccc-0000-0000-0000-cccccccccccc';

const MOCK_MAP  = { id: MAP_ID, userId: USER_ID };

/** Raw row shape as returned by the ST_X/ST_Y SELECT — mirrors RawAnnotationRow */
const MOCK_ANNOT_ROW = {
  id: ANNOT_ID,
  mapId: MAP_ID,
  userId: USER_ID,
  authorName: 'Test User',
  lng: -122.4,
  lat: 37.8,
  content: { type: 'text', text: 'Hello world' },
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
};

function makeCaller() {
  return annotationsRouter.createCaller({
    user: { id: USER_ID, name: 'Test User' } as unknown as User,
    session: { id: 'sess', userId: USER_ID, expiresAt: new Date(Date.now() + 3_600_000), fresh: false },
    event: {} as RequestEvent,
  });
}

// ─── annotations.list ────────────────────────────────────────────────────────

describe('annotations.list', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns annotations in chronological order', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP])); // ownership
    vi.mocked(db.execute).mockResolvedValueOnce(
      { rows: [MOCK_ANNOT_ROW] } as unknown as DbExecuteResult
    );

    const result = await makeCaller().list({ mapId: MAP_ID });

    expect(result).toHaveLength(1);
    // `result` length asserted above — safe to access index 0
    const annotation = result[0] as (typeof result)[0];
    expect(annotation.id).toBe(ANNOT_ID);
    expect(annotation.anchor.type).toBe('Point');
    expect(annotation.anchor.coordinates).toEqual([-122.4, 37.8]);
    expect(annotation.content).toEqual({ type: 'text', text: 'Hello world' });
  });

  it('returns empty array when map has no annotations', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.execute).mockResolvedValueOnce({ rows: [] } as unknown as DbExecuteResult);

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

// ─── annotations.create ──────────────────────────────────────────────────────

describe('annotations.create', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates a text annotation and returns it with a reconstructed anchor', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP])); // ownership
    vi.mocked(db.execute).mockResolvedValueOnce(
      { rows: [MOCK_ANNOT_ROW] } as unknown as DbExecuteResult
    );

    const result = await makeCaller().create({
      mapId: MAP_ID,
      anchor: { type: 'Point', coordinates: [-122.4, 37.8] },
      content: { type: 'text', text: 'Hello world' },
    });

    expect(result.anchor.coordinates).toEqual([-122.4, 37.8]);
    expect(result.authorName).toBe('Test User');
    expect(result.content.type).toBe('text');
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('creates an emoji annotation', async () => {
    const emojiRow = { ...MOCK_ANNOT_ROW, content: { type: 'emoji', emoji: '🌊', label: 'Ocean' } };
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.execute).mockResolvedValueOnce(
      { rows: [emojiRow] } as unknown as DbExecuteResult
    );

    const result = await makeCaller().create({
      mapId: MAP_ID,
      anchor: { type: 'Point', coordinates: [-122.4, 37.8] },
      content: { type: 'emoji', emoji: '🌊', label: 'Ocean' },
    });

    expect(result.content.type).toBe('emoji');
  });

  it('creates an iiif annotation without navPlace', async () => {
    const iiifRow = { ...MOCK_ANNOT_ROW, content: { type: 'iiif', manifestUrl: 'https://example.com/manifest.json', label: 'Test Manifest' } };
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.execute).mockResolvedValueOnce(
      { rows: [iiifRow] } as unknown as DbExecuteResult
    );

    const result = await makeCaller().create({
      mapId: MAP_ID,
      anchor: { type: 'Point', coordinates: [-122.4, 37.8] },
      content: { type: 'iiif', manifestUrl: 'https://example.com/manifest.json', label: 'Test Manifest' },
    });

    expect(result.content.type).toBe('iiif');
  });

  it('throws NOT_FOUND when map does not belong to caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().create({
        mapId: MAP_ID,
        anchor: { type: 'Point', coordinates: [0, 0] },
        content: { type: 'text', text: 'Hi' },
      })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('rejects anchor longitude out of WGS84 range', async () => {
    await expect(
      makeCaller().create({
        mapId: MAP_ID,
        anchor: { type: 'Point', coordinates: [200, 0] }, // lng > 180 is invalid
        content: { type: 'text', text: 'Hi' },
      })
    ).rejects.toThrow();
  });

  it('rejects empty text content', async () => {
    await expect(
      makeCaller().create({
        mapId: MAP_ID,
        anchor: { type: 'Point', coordinates: [0, 0] },
        content: { type: 'text', text: '' }, // min(1) violated
      })
    ).rejects.toThrow();
  });
});

// ─── annotations.update ──────────────────────────────────────────────────────

describe('annotations.update', () => {
  beforeEach(() => vi.resetAllMocks());

  it('updates annotation content and returns updated row', async () => {
    const updatedRow = { ...MOCK_ANNOT_ROW, content: { type: 'text', text: 'Updated text' } };

    vi.mocked(db.select).mockReturnValueOnce(
      drizzleChain([{ id: ANNOT_ID, userId: USER_ID }]) // existence + authorship
    );
    vi.mocked(db.execute).mockResolvedValueOnce(
      { rows: [updatedRow] } as unknown as DbExecuteResult
    );

    const result = await makeCaller().update({
      id: ANNOT_ID,
      content: { type: 'text', text: 'Updated text' },
    });

    expect((result.content as { type: string; text: string }).text).toBe('Updated text');
  });

  it('throws NOT_FOUND when annotation does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(
      makeCaller().update({ id: ANNOT_ID, content: { type: 'text', text: 'Hi' } })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws FORBIDDEN when caller does not own the annotation', async () => {
    const otherUserId = 'dddddddd-0000-0000-0000-dddddddddddd';
    vi.mocked(db.select).mockReturnValueOnce(
      drizzleChain([{ id: ANNOT_ID, userId: otherUserId }]) // belongs to someone else
    );

    await expect(
      makeCaller().update({ id: ANNOT_ID, content: { type: 'text', text: 'Hi' } })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

// ─── annotations.delete ──────────────────────────────────────────────────────

describe('annotations.delete', () => {
  beforeEach(() => vi.resetAllMocks());

  it('deletes own annotation and returns { deleted: true }', async () => {
    vi.mocked(db.select).mockReturnValueOnce(
      drizzleChain([{ id: ANNOT_ID, userId: USER_ID }])
    );
    vi.mocked(db.delete).mockReturnValue(
      drizzleChain(undefined) as unknown as ReturnType<typeof db.delete>
    );

    const result = await makeCaller().delete({ id: ANNOT_ID });
    expect(result).toEqual({ deleted: true });
    expect(db.delete).toHaveBeenCalledOnce();
  });

  it('throws NOT_FOUND when annotation does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().delete({ id: ANNOT_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws FORBIDDEN when caller does not own the annotation', async () => {
    const otherUserId = 'dddddddd-0000-0000-0000-dddddddddddd';
    vi.mocked(db.select).mockReturnValueOnce(
      drizzleChain([{ id: ANNOT_ID, userId: otherUserId }])
    );

    await expect(makeCaller().delete({ id: ANNOT_ID })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });
});

// ─── annotations.fetchIiifNavPlace ───────────────────────────────────────────

describe('annotations.fetchIiifNavPlace', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  const MANIFEST_URL = 'https://example.com/iiif/manifest.json';

  const MOCK_NAV_PLACE_FC = {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
        properties: {},
      },
    ],
  };

  it('returns a FeatureCollection when manifest has navPlace as FeatureCollection', async () => {
    const manifest = { '@context': 'https://iiif.io/api/presentation/3/context.json', navPlace: MOCK_NAV_PLACE_FC };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(manifest),
    } as Response);

    const result = await makeCaller().fetchIiifNavPlace({ manifestUrl: MANIFEST_URL });
    expect(result?.type).toBe('FeatureCollection');
    expect(result?.features).toHaveLength(1);
  });

  it('wraps a single Feature navPlace in a FeatureCollection', async () => {
    const singleFeature = {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-122.4, 37.8] },
      properties: {},
    };
    const manifest = { navPlace: singleFeature };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(manifest),
    } as Response);

    const result = await makeCaller().fetchIiifNavPlace({ manifestUrl: MANIFEST_URL });
    expect(result?.type).toBe('FeatureCollection');
    expect(result?.features).toHaveLength(1);
  });

  it('returns null when manifest has no navPlace extension', async () => {
    const manifest = { '@context': 'https://iiif.io/api/presentation/3/context.json', label: 'No navPlace' };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(manifest),
    } as Response);

    const result = await makeCaller().fetchIiifNavPlace({ manifestUrl: MANIFEST_URL });
    expect(result).toBeNull();
  });

  it('throws BAD_REQUEST when the upstream server returns a non-2xx status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 404 } as Response);

    await expect(
      makeCaller().fetchIiifNavPlace({ manifestUrl: MANIFEST_URL })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
  });
});
