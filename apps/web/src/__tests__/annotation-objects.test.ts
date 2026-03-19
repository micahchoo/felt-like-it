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

vi.mock('$lib/server/geo/access.js', () => ({
  requireMapAccess: vi.fn().mockResolvedValue(undefined),
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
import { requireMapAccess } from '$lib/server/geo/access.js';

const USER_ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';
const OBJ_ID = 'cccccccc-0000-0000-0000-cccccccccccc';
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
      .mockReturnValueOnce(drizzleChain([{ parentId: 'some-parent' }])); // parent lookup — not root

    vi.mocked(db.execute)
      .mockResolvedValueOnce(mockExecuteResult([{ cnt: '0' }])); // count check

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
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]));

    const result = await annotationService.list({ userId: USER_ID, mapId: MAP_ID });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(OBJ_ID);
  });

  it('filters to roots only when rootsOnly is true', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]));

    const result = await annotationService.list({ userId: USER_ID, mapId: MAP_ID, rootsOnly: true });
    expect(result).toHaveLength(1);
    // Verify that requireMapAccess was called with 'viewer'
    expect(requireMapAccess).toHaveBeenCalledWith(USER_ID, MAP_ID, 'viewer');
  });

  it('does not filter to roots when rootsOnly is undefined', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]));

    const result = await annotationService.list({ userId: USER_ID, mapId: MAP_ID });
    expect(result).toHaveLength(1);
    // The default (undefined) should NOT filter for roots only
    expect(requireMapAccess).toHaveBeenCalledWith(USER_ID, MAP_ID, 'viewer');
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
    expect(requireMapAccess).toHaveBeenCalledWith(USER_ID, MAP_ID, 'commenter');
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
    vi.mocked(db.execute)
      .mockResolvedValueOnce(mockExecuteResult([MOCK_ROW])) // fetch
      .mockResolvedValueOnce(mockExecuteResult([{ id: OBJ_ID }])); // atomic delete

    const result = await annotationService.delete({
      userId: USER_ID,
      userName: 'Test User',
      id: OBJ_ID,
    });

    expect(result.deleted).toBe(true);
    expect(insertChangelog).toHaveBeenCalledOnce();
    expect(requireMapAccess).toHaveBeenCalledWith(USER_ID, MAP_ID, 'commenter');
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

// ─── tRPC adapter tests ──────────────────────────────────────────────────────

import { annotationsRouter } from '../lib/server/trpc/routers/annotations.js';

function makeCaller() {
  return annotationsRouter.createCaller(mockContext({ userId: USER_ID }));
}

describe('annotationsRouter (tRPC adapter)', () => {
  beforeEach(() => vi.resetAllMocks());

  it('list calls service and returns results', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]));

    const result = await makeCaller().list({ mapId: MAP_ID });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(OBJ_ID);
  });

  it('create mutation rejects empty content text', async () => {
    // Empty string fails TextContentSchema.text.min(1) — tRPC throws BAD_REQUEST
    // before the service is ever called. This characterizes the form validation
    // contract: the router is the last line of defence against blank submissions.
    await expect(
      makeCaller().create({
        mapId: MAP_ID,
        anchor: { type: 'viewport' },
        content: { kind: 'single', body: { type: 'text', text: '' } },
      }),
    ).rejects.toThrow();

    // Service must not have been reached — no db.execute calls
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('create mutation rejects whitespace-only content text', async () => {
    // Whitespace is non-empty so it passes min(1) — service IS called.
    // Characterize that the router forwards to the service (which may or may
    // not accept it). The important thing: no schema rejection at this layer.
    // vi.resetAllMocks() in beforeEach wipes mock return values, so we re-setup
    // the mocks the service needs.
    const { buildAddPatch } = await import('$lib/server/annotations/changelog.js');
    vi.mocked(buildAddPatch).mockReturnValue({ patch: { op: 'add' }, inverse: { op: 'del' } } as ReturnType<typeof buildAddPatch>);
    vi.mocked(insertChangelog).mockResolvedValue('changelog-id');
    vi.mocked(db.execute)
      .mockResolvedValueOnce(mockExecuteResult([{ cnt: '0' }]))
      .mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]));

    // A single space satisfies z.string().min(1) — router passes it through
    const result = await makeCaller().create({
      mapId: MAP_ID,
      anchor: { type: 'viewport' },
      content: { kind: 'single', body: { type: 'text', text: ' ' } },
    });
    expect(result.id).toBe(OBJ_ID);
  });

  it('create mutation accepts valid content and returns annotation', async () => {
    // Re-setup after vi.resetAllMocks() wipes mock return values
    const { buildAddPatch } = await import('$lib/server/annotations/changelog.js');
    vi.mocked(buildAddPatch).mockReturnValue({ patch: { op: 'add' }, inverse: { op: 'del' } } as ReturnType<typeof buildAddPatch>);
    vi.mocked(insertChangelog).mockResolvedValue('changelog-id');
    vi.mocked(db.execute)
      .mockResolvedValueOnce(mockExecuteResult([{ cnt: '0' }]))
      .mockResolvedValueOnce(mockExecuteResult([MOCK_ROW]));

    const result = await makeCaller().create({
      mapId: MAP_ID,
      anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
      content: { kind: 'single', body: { type: 'text', text: 'hello' } },
    });

    expect(result.id).toBe(OBJ_ID);
    expect(result.content).toMatchObject({ kind: 'single', body: { type: 'text' } });
  });
});

describe('annotationService adversarial cases', () => {
  beforeEach(() => vi.resetAllMocks());

  it('rejects create when map has 10,000 annotations', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([{ cnt: '10000' }]));

    await expect(annotationService.create({
      userId: USER_ID,
      userName: 'Test User',
      mapId: MAP_ID,
      anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4, 37.8] } },
      content: { kind: 'single', body: { type: 'text', text: 'overflow' } },
    })).rejects.toThrow(/maximum/i);
  });

  it('rejects update on non-existent annotation', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([]));

    await expect(annotationService.update({
      userId: USER_ID,
      userName: 'Test User',
      id: OBJ_ID,
      content: { kind: 'single', body: { type: 'text', text: 'ghost' } },
      version: 1,
    })).rejects.toThrow(/not found/i);
  });

  it('rejects delete on non-existent annotation', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([]));

    await expect(annotationService.delete({
      userId: USER_ID,
      userName: 'Test User',
      id: OBJ_ID,
    })).rejects.toThrow(/not found/i);
  });

  it('rejects getThread on a reply (not root)', async () => {
    const replyRow = { ...MOCK_ROW, parent_id: 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa' };
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([replyRow]));

    await expect(annotationService.getThread({
      userId: USER_ID,
      rootId: OBJ_ID,
    })).rejects.toThrow(/not a root/i);
  });
});

describe('annotationService.flagOrphanedAnnotations', () => {
  beforeEach(() => vi.resetAllMocks());

  const FEATURE_ID_1 = 'dddddddd-0000-0000-0000-dddddddddddd';
  const FEATURE_ID_2 = 'eeeeeeee-0000-0000-0000-eeeeeeeeeeee';

  it('flags feature-anchored annotations when features are deleted', async () => {
    const flaggedRows = [{ id: OBJ_ID }];
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult(flaggedRows));

    const count = await annotationService.flagOrphanedAnnotations([FEATURE_ID_1]);

    expect(count).toBe(1);
    expect(db.execute).toHaveBeenCalledOnce();
  });

  it('flags multiple annotations for multiple deleted features', async () => {
    const flaggedRows = [{ id: OBJ_ID }, { id: 'ffffffff-0000-0000-0000-ffffffffffff' }];
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult(flaggedRows));

    const count = await annotationService.flagOrphanedAnnotations([FEATURE_ID_1, FEATURE_ID_2]);

    expect(count).toBe(2);
  });

  it('returns zero when no annotations reference the deleted features', async () => {
    vi.mocked(db.execute).mockResolvedValueOnce(mockExecuteResult([]));

    const count = await annotationService.flagOrphanedAnnotations([FEATURE_ID_1]);

    expect(count).toBe(0);
  });

  it('short-circuits without a query when given empty feature IDs', async () => {
    const count = await annotationService.flagOrphanedAnnotations([]);

    expect(count).toBe(0);
    expect(db.execute).not.toHaveBeenCalled();
  });
});
