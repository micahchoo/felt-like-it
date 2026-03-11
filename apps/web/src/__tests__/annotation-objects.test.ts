// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    execute: vi.fn(),
  },
  maps: { id: {}, userId: {} },
  annotations: { id: {}, mapId: {}, userId: {} },
  annotationObjects: { id: {}, mapId: {}, parentId: {}, authorId: {}, ordinal: {}, version: {} },
  annotationChangelog: { id: {}, mapId: {}, objectId: {}, authorId: {} },
  mapCollaborators: { mapId: {}, userId: {}, role: {} },
}));

vi.mock('$lib/server/annotations/changelog.js', () => ({
  buildAddPatch: vi.fn(() => ({ patch: { op: 'add' }, inverse: { op: 'del' } })),
  buildModPatch: vi.fn(() => ({ patch: { op: 'mod' }, inverse: { op: 'mod' } })),
  buildDelPatch: vi.fn(() => ({ patch: { op: 'del' }, inverse: { op: 'add' } })),
  insertChangelog: vi.fn().mockResolvedValue('changelog-id'),
}));

import { db } from '$lib/server/db/index.js';
import { drizzleChain, mockContext, mockExecuteResult } from './test-utils.js';
import { insertChangelog } from '$lib/server/annotations/changelog.js';

const USER_ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const OBJ_ID = 'cccccccc-0000-0000-0000-cccccccccccc';
const MOCK_MAP = { id: MAP_ID, userId: USER_ID };

const MOCK_ROW = {
  id: OBJ_ID,
  map_id: MAP_ID,
  parent_id: null,
  author_id: USER_ID,
  author_name: 'Test User',
  anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
  content: { kind: 'single', body: { type: 'text', text: 'hello' } },
  template_id: null,
  ordinal: 0,
  version: 1,
  created_at: new Date('2025-01-01'),
  updated_at: new Date('2025-01-01'),
};

// Import service after mocks
import { annotationService } from '../lib/server/annotations/service.js';

describe('annotationService.create', () => {
  beforeEach(() => vi.clearAllMocks());

  it('inserts annotation and changelog entry', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP])); // access check
    vi.mocked(db.execute)
      .mockResolvedValueOnce(mockExecuteResult([{ cnt: '0' }])) // count check
      .mockResolvedValueOnce(mockExecuteResult([MOCK_ROW])); // insert

    const result = await annotationService.create({
      userId: USER_ID,
      userName: 'Test User',
      mapId: MAP_ID,
      anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
      content: { kind: 'single', body: { type: 'text', text: 'hello' } },
    });

    expect(result.id).toBe(OBJ_ID);
    expect(result.anchor.type).toBe('point');
    expect(insertChangelog).toHaveBeenCalledOnce();
  });

  it('rejects replies to non-root annotations', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP])) // access check
      .mockReturnValueOnce(drizzleChain([{ parentId: 'some-parent' }])); // parent lookup — not root

    vi.mocked(db.execute)
      .mockResolvedValueOnce(mockExecuteResult([])); // count check

    await expect(annotationService.create({
      userId: USER_ID,
      userName: 'Test User',
      mapId: MAP_ID,
      parentId: OBJ_ID,
      anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
      content: { kind: 'single', body: { type: 'text', text: 'reply' } },
    })).rejects.toThrow(/root annotation/i);
  });
});

describe('annotationService.list', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns annotations for a map', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]));

    const result = await annotationService.list({ userId: USER_ID, mapId: MAP_ID });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe(OBJ_ID);
  });
});

describe('annotationService.update', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates content and increments version', async () => {
    const updatedRow = { ...MOCK_ROW, version: 2, content: { kind: 'single', body: { type: 'text', text: 'updated' } } };
    vi.mocked(db.execute)
      .mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]))  // fetch current
      .mockResolvedValueOnce(mockExecuteResult([updatedRow])); // update

    const result = await annotationService.update({
      userId: USER_ID,
      userName: 'Test User',
      id: OBJ_ID,
      content: { kind: 'single', body: { type: 'text', text: 'updated' } },
      version: 1,
    });

    expect(result.version).toBe(2);
    expect(insertChangelog).toHaveBeenCalledOnce();
  });

  it('rejects update with stale version', async () => {
    const staleRow = { ...MOCK_ROW, version: 3 };
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([staleRow]));

    await expect(annotationService.update({
      userId: USER_ID,
      userName: 'Test User',
      id: OBJ_ID,
      content: { kind: 'single', body: { type: 'text', text: 'stale' } },
      version: 1,
    })).rejects.toThrow(/conflict|version/i);
  });
});

describe('annotationService.delete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes annotation and records changelog', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([MOCK_ROW])); // fetch
    vi.mocked(db.delete).mockReturnValueOnce(drizzleChain([])); // delete

    const result = await annotationService.delete({
      userId: USER_ID,
      userName: 'Test User',
      id: OBJ_ID,
    });

    expect(result.deleted).toBe(true);
    expect(insertChangelog).toHaveBeenCalledOnce();
  });

  it('rejects delete by non-author', async () => {
    const otherUserRow = { ...MOCK_ROW, author_id: 'dddddddd-0000-0000-0000-dddddddddddd' };
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([otherUserRow]));

    await expect(annotationService.delete({
      userId: USER_ID,
      userName: 'Test User',
      id: OBJ_ID,
    })).rejects.toThrow(/forbidden/i);
  });
});
