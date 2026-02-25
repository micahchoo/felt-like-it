// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- Module mocks ---

vi.mock('$lib/server/audit/index.js', () => ({ appendAuditLog: vi.fn() }));

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select:      vi.fn(),
    insert:      vi.fn(),
    update:      vi.fn(),
    delete:      vi.fn(),
    execute:     vi.fn(),
    transaction: vi.fn(),
  },
  maps:             { id: {}, userId: {}, isArchived: {}, isTemplate: {}, updatedAt: {}, title: {}, description: {}, viewport: {}, basemap: {}, createdAt: {} },
  layers:           { mapId: {}, zIndex: {}, id: {}, style: {} },
  mapCollaborators: { mapId: {}, userId: {}, role: {} },
  users: {},
}));

import { mapsRouter } from '../lib/server/trpc/routers/maps.js';
import { db } from '$lib/server/db/index.js';
import { appendAuditLog } from '$lib/server/audit/index.js';
import { drizzleChain, mockContext, type DbExecuteResult } from './test-utils.js';

const USER_ID = 'aaaaaaaa-0000-0000-0000-aaaaaaaaaaaa';
const MAP_ID  = 'bbbbbbbb-0000-0000-0000-bbbbbbbbbbbb';

const MOCK_MAP = {
  id: MAP_ID,
  userId: USER_ID,
  title: 'Test Map',
  description: null,
  viewport: { center: [-122.4, 37.7] as [number, number], zoom: 10, bearing: 0, pitch: 0 },
  basemap: 'osm',
  isArchived: false,
  isTemplate: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const TEMPLATE_MAP_ID = 'cccccccc-0000-4000-0000-cccccccccccc';
const MOCK_TEMPLATE = {
  id: TEMPLATE_MAP_ID,
  userId: 'system-user-id',
  title: 'World Overview',
  description: 'A blank world map.',
  viewport: { center: [0, 20] as [number, number], zoom: 2, bearing: 0, pitch: 0 },
  basemap: 'osm',
  isArchived: false,
  isTemplate: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeCaller() {
  return mapsRouter.createCaller(mockContext({ userId: USER_ID }));
}

// --- Tests ---

describe('maps.list', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns maps for the authenticated user', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))      // maps query
      .mockReturnValueOnce(drizzleChain([{ mapId: MAP_ID, count: 3 }])); // layer counts

    const result = await makeCaller().list();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(MAP_ID);
    expect(result[0]?.layerCount).toBe(3);
  });

  it('returns layerCount 0 for maps with no layers', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([])); // no layer count rows

    const result = await makeCaller().list();
    expect(result[0]?.layerCount).toBe(0);
  });
});

describe('maps.get', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns the map with its layers', async () => {
    const mockLayer = { id: 'l1', mapId: MAP_ID, name: 'Layer A', type: 'polygon', style: {}, visible: true, zIndex: 0, sourceFileName: null, createdAt: new Date(), updatedAt: new Date() };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))
      .mockReturnValueOnce(drizzleChain([mockLayer]));

    const result = await makeCaller().get({ id: MAP_ID });

    expect(result.id).toBe(MAP_ID);
    expect(result.layers).toHaveLength(1);
    expect(result.layers[0]?.id).toBe('l1');
  });

  it('throws NOT_FOUND when the map belongs to a different user', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([])); // no rows → map not found for this user

    await expect(makeCaller().get({ id: MAP_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('maps.create', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates and returns a new map', async () => {
    vi.mocked(db.insert).mockReturnValue(drizzleChain([MOCK_MAP]));

    const result = await makeCaller().create({ title: 'My New Map' });

    expect(result.id).toBe(MAP_ID);
    expect(result.title).toBe('Test Map');
    expect(db.insert).toHaveBeenCalledOnce();
  });

  it('throws INTERNAL_SERVER_ERROR when insert returns nothing', async () => {
    vi.mocked(db.insert).mockReturnValue(drizzleChain([]));

    await expect(makeCaller().create({ title: 'Fail' })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });
});

describe('maps.update', () => {
  beforeEach(() => vi.resetAllMocks());

  it('updates the map and returns the updated record', async () => {
    const updated = { ...MOCK_MAP, title: 'Renamed Map' };
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.update).mockReturnValue(drizzleChain([updated]));

    const result = await makeCaller().update({ id: MAP_ID, title: 'Renamed Map' });
    expect(result?.title).toBe('Renamed Map');
  });

  it('calls appendAuditLog with map.update after a successful update', async () => {
    const updated = { ...MOCK_MAP, title: 'Renamed Map' };
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.update).mockReturnValue(drizzleChain([updated]));

    await makeCaller().update({ id: MAP_ID, title: 'Renamed Map' });

    expect(appendAuditLog).toHaveBeenCalledWith({
      userId: USER_ID,
      action: 'map.update',
      entityType: 'map',
      entityId: MAP_ID,
      mapId: MAP_ID,
    });
  });

  it('throws NOT_FOUND when the map does not belong to the caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().update({ id: MAP_ID, title: 'X' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});

describe('maps.delete', () => {
  beforeEach(() => vi.resetAllMocks());

  it('deletes the map and returns { deleted: true }', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.delete).mockReturnValue(drizzleChain(undefined));

    const result = await makeCaller().delete({ id: MAP_ID });
    expect(result).toEqual({ deleted: true });
  });

  it('throws NOT_FOUND when the map does not belong to the caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().delete({ id: MAP_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('maps.listTemplates', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns all template maps regardless of ownership', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_TEMPLATE]));

    const result = await makeCaller().listTemplates();

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(TEMPLATE_MAP_ID);
    expect(result[0]?.title).toBe('World Overview');
  });

  it('returns empty array when no templates exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    const result = await makeCaller().listTemplates();
    expect(result).toHaveLength(0);
  });

  it('returns viewport cast as typed object', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([MOCK_TEMPLATE]));

    const result = await makeCaller().listTemplates();
    expect(result[0]?.viewport.center).toEqual([0, 20]);
    expect(result[0]?.viewport.zoom).toBe(2);
  });
});

describe('maps.createFromTemplate', () => {
  const NEW_MAP_ID = 'ffffffff-0000-0000-0000-ffffffffffff';

  beforeEach(() => vi.resetAllMocks());

  it('creates a user-owned map from a template and returns it', async () => {
    const newMap = { ...MOCK_TEMPLATE, id: NEW_MAP_ID, userId: USER_ID, isTemplate: false };

    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_TEMPLATE]))  // template lookup
      .mockReturnValueOnce(drizzleChain([]));              // no layers on template
    vi.mocked(db.insert).mockReturnValue(drizzleChain([newMap]));

    const result = await makeCaller().createFromTemplate({ id: TEMPLATE_MAP_ID });

    expect(result.id).toBe(NEW_MAP_ID);
    expect(result.isTemplate).toBe(false);
    expect(result.userId).toBe(USER_ID);
    expect(db.insert).toHaveBeenCalledOnce(); // only map insert (no layers to copy)
  });

  it('copies layer config from template but skips feature copy', async () => {
    const newMap = { ...MOCK_TEMPLATE, id: NEW_MAP_ID, userId: USER_ID, isTemplate: false };
    const LAYER_ID = 'llllllll-0000-0000-0000-llllllllllll';
    const templateLayer = {
      id: LAYER_ID, mapId: TEMPLATE_MAP_ID, name: 'Base Layer',
      type: 'polygon', style: {}, visible: true, zIndex: 0, sourceFileName: null,
      createdAt: new Date(), updatedAt: new Date(),
    };

    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_TEMPLATE]))     // template lookup
      .mockReturnValueOnce(drizzleChain([templateLayer]));   // layers
    vi.mocked(db.insert)
      .mockReturnValueOnce(drizzleChain([newMap])) // map
      .mockReturnValueOnce(drizzleChain([{id: 'new-layer'}])); // layer

    await makeCaller().createFromTemplate({ id: TEMPLATE_MAP_ID });

    // 2 inserts: map + 1 layer. NO db.execute (no feature copy for templates).
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(db.execute).not.toHaveBeenCalled();
  });

  it('throws NOT_FOUND when template does not exist', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().createFromTemplate({ id: TEMPLATE_MAP_ID })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('throws INTERNAL_SERVER_ERROR when map insert returns nothing', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_TEMPLATE]));
    vi.mocked(db.insert).mockReturnValue(drizzleChain([]));

    await expect(makeCaller().createFromTemplate({ id: TEMPLATE_MAP_ID })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });
});

describe('maps.clone', () => {
  const CLONED_MAP_ID = 'eeeeeeee-0000-0000-0000-eeeeeeeeeeee';
  const LAYER_ID      = 'llllllll-0000-0000-0000-llllllllllll';
  const NEW_LAYER_ID  = 'nnnnnnnn-0000-0000-0000-nnnnnnnnnnnn';

  const MOCK_LAYER = {
    id: LAYER_ID, mapId: MAP_ID, name: 'Layer A', type: 'polygon',
    style: {}, visible: true, zIndex: 0, sourceFileName: null,
    createdAt: new Date(), updatedAt: new Date(),
  };

  beforeEach(() => vi.resetAllMocks());

  it('clones a map with its layers and returns the new map', async () => {
    const clonedMap = { ...MOCK_MAP, id: CLONED_MAP_ID, title: 'Copy of Test Map' };
    const newLayer  = { ...MOCK_LAYER, id: NEW_LAYER_ID, mapId: CLONED_MAP_ID };

    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))       // ownership check
      .mockReturnValueOnce(drizzleChain([MOCK_LAYER]));    // get layers
    vi.mocked(db.insert)
      .mockReturnValueOnce(drizzleChain([clonedMap]))
      .mockReturnValueOnce(drizzleChain([newLayer]));
    vi.mocked(db.execute).mockResolvedValue({ rows: [] } as DbExecuteResult);

    const result = await makeCaller().clone({ id: MAP_ID });

    expect(result.title).toBe('Copy of Test Map');
    expect(result.id).toBe(CLONED_MAP_ID);
    expect(db.insert).toHaveBeenCalledTimes(2); // map + 1 layer
    expect(db.execute).toHaveBeenCalledOnce();  // feature copy for the 1 layer
  });

  it('clones a map with no layers (empty feature copy)', async () => {
    const clonedMap = { ...MOCK_MAP, id: CLONED_MAP_ID, title: 'Copy of Test Map' };

    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]))   // ownership check
      .mockReturnValueOnce(drizzleChain([]));           // no layers
    vi.mocked(db.insert)
      .mockReturnValueOnce(drizzleChain([clonedMap]));

    const result = await makeCaller().clone({ id: MAP_ID });
    expect(result.id).toBe(CLONED_MAP_ID);
    expect(db.insert).toHaveBeenCalledOnce();  // only map insert
    expect(db.execute).not.toHaveBeenCalled(); // no layers → no feature copy
  });

  it('throws NOT_FOUND when map does not belong to the caller', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().clone({ id: MAP_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('throws INTERNAL_SERVER_ERROR when map insert returns nothing', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([MOCK_MAP]));
    vi.mocked(db.insert)
      .mockReturnValueOnce(drizzleChain([]));

    await expect(makeCaller().clone({ id: MAP_ID })).rejects.toMatchObject({
      code: 'INTERNAL_SERVER_ERROR',
    });
  });
});

describe('maps.get — collaborator access', () => {
  const OTHER_USER_ID = 'dddddddd-0000-0000-0000-dddddddddddd';
  const COLLAB_MAP    = { ...MOCK_MAP, userId: OTHER_USER_ID };

  beforeEach(() => vi.resetAllMocks());

  it('returns the map for a collaborator (viewer role)', async () => {
    const mockLayer = { id: 'l1', mapId: MAP_ID, name: 'Layer A', type: 'polygon', style: {}, visible: true, zIndex: 0, sourceFileName: null, createdAt: new Date(), updatedAt: new Date() };
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([COLLAB_MAP]))               // map (not owner)
      .mockReturnValueOnce(drizzleChain([{ role: 'viewer' }]))       // collaborator check
      .mockReturnValueOnce(drizzleChain([mockLayer]));               // layers

    const result = await makeCaller().get({ id: MAP_ID });
    expect(result.id).toBe(MAP_ID);
    expect(result.layers).toHaveLength(1);
  });

  it('throws NOT_FOUND when user is not a collaborator on another user\'s map', async () => {
    vi.mocked(db.select)
      .mockReturnValueOnce(drizzleChain([COLLAB_MAP]))   // map (not owner)
      .mockReturnValueOnce(drizzleChain([]));             // no collaborator record

    await expect(makeCaller().get({ id: MAP_ID })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('maps.listCollaborating', () => {
  beforeEach(() => vi.resetAllMocks());

  it('returns maps where the user is an invited collaborator', async () => {
    const sharedMap = {
      id: MAP_ID,
      title: 'Shared Map',
      description: null,
      basemap: 'osm',
      isArchived: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: 'viewer',
    };
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([sharedMap]));

    const result = await makeCaller().listCollaborating();
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe(MAP_ID);
    expect(result[0]?.role).toBe('viewer');
  });

  it('returns empty array when the user has no shared maps', async () => {
    vi.mocked(db.select).mockReturnValueOnce(drizzleChain([]));

    const result = await makeCaller().listCollaborating();
    expect(result).toHaveLength(0);
  });
});
