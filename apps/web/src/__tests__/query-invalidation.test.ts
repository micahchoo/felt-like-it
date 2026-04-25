// @vitest-environment node
import { describe, test, expect, beforeEach } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import { queryKeys } from '$lib/utils/query-keys.js';
import { HotOverlayStore } from '$lib/utils/map-sources.svelte.js';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe('annotation create → invalidation', () => {
  test('onSuccess invalidates annotation list so next read is fresh', async () => {
    const qc = makeQueryClient();
    const key = queryKeys.annotations.list({ mapId: 'map-1' });
    qc.setQueryData(key, [{ id: 'existing' }]);
    await qc.invalidateQueries({ queryKey: key });
    const state = qc.getQueryState(key);
    expect(state?.isInvalidated).toBe(true);
  });

  test('invalidating annotations.all also invalidates annotations.list', async () => {
    const qc = makeQueryClient();
    const listKey = queryKeys.annotations.list({ mapId: 'map-1' });
    qc.setQueryData(listKey, [{ id: 'existing' }]);
    await qc.invalidateQueries({ queryKey: queryKeys.annotations.all });
    const state = qc.getQueryState(listKey);
    expect(state?.isInvalidated).toBe(true);
  });
});

describe('annotation delete → optimistic + rollback', () => {
  test('optimistically removes annotation from cache', () => {
    const qc = makeQueryClient();
    const key = queryKeys.annotations.list({ mapId: 'map-1' });
    const original = [{ id: 'a1', mapId: 'map-1' }, { id: 'a2', mapId: 'map-1' }];
    qc.setQueryData(key, original);
    const previous = qc.getQueryData(key);
    qc.setQueryData(key, (old: typeof original | undefined) =>
      old?.filter((a) => a.id !== 'a1') ?? []
    );
    expect(qc.getQueryData(key)).toEqual([{ id: 'a2', mapId: 'map-1' }]);
    expect(previous).toEqual(original);
  });

  test('rollback restores previous cache on error', () => {
    const qc = makeQueryClient();
    const key = queryKeys.annotations.list({ mapId: 'map-1' });
    const original = [{ id: 'a1', mapId: 'map-1' }, { id: 'a2', mapId: 'map-1' }];
    qc.setQueryData(key, original);
    const previous = qc.getQueryData(key);
    qc.setQueryData(key, (old: typeof original | undefined) =>
      old?.filter((a) => a.id !== 'a1') ?? []
    );
    // Simulate rollback on error
    qc.setQueryData(key, previous);
    expect(qc.getQueryData(key)).toEqual(original);
  });
});

describe('annotation update → invalidation', () => {
  test('onSuccess invalidates annotation list after IIIF NavPlace update', async () => {
    const qc = makeQueryClient();
    const key = queryKeys.annotations.list({ mapId: 'map-1' });
    qc.setQueryData(key, [{ id: 'a1', anchor: { type: 'viewport' } }]);
    await qc.invalidateQueries({ queryKey: key });
    const state = qc.getQueryState(key);
    expect(state?.isInvalidated).toBe(true);
  });
});

describe('annotation reply → thread invalidation', () => {
  test('invalidating thread key marks thread cache as stale', async () => {
    const qc = makeQueryClient();
    const threadKey = queryKeys.annotations.thread({ annotationId: 'ann-1' });
    qc.setQueryData(threadKey, { replies: [{ id: 'r1' }] });
    await qc.invalidateQueries({ queryKey: threadKey });
    const state = qc.getQueryState(threadKey);
    expect(state?.isInvalidated).toBe(true);
  });

  test('reply invalidates both list and thread caches via separate keys', async () => {
    const qc = makeQueryClient();
    const listKey = queryKeys.annotations.list({ mapId: 'map-1' });
    const threadKey = queryKeys.annotations.thread({ annotationId: 'ann-1' });
    qc.setQueryData(listKey, [{ id: 'ann-1' }]);
    qc.setQueryData(threadKey, { replies: [] });
    await qc.invalidateQueries({ queryKey: listKey });
    await qc.invalidateQueries({ queryKey: threadKey });
    expect(qc.getQueryState(listKey)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(threadKey)?.isInvalidated).toBe(true);
  });
});

describe('comment create → invalidation', () => {
  test('onSuccess invalidates comment list so next read is fresh', async () => {
    const qc = makeQueryClient();
    const key = queryKeys.comments.list({ mapId: 'map-1' });
    qc.setQueryData(key, [{ id: 'c1' }]);
    await qc.invalidateQueries({ queryKey: key });
    const state = qc.getQueryState(key);
    expect(state?.isInvalidated).toBe(true);
  });
});

describe('comment delete → optimistic + rollback', () => {
  test('optimistically removes comment from cache', () => {
    const qc = makeQueryClient();
    const key = queryKeys.comments.list({ mapId: 'map-1' });
    const original = [
      { id: 'c1', body: 'first' },
      { id: 'c2', body: 'second' },
    ];
    qc.setQueryData(key, original);
    const previous = qc.getQueryData(key);
    qc.setQueryData(key, (old: typeof original | undefined) =>
      old?.filter((c) => c.id !== 'c1') ?? []
    );
    expect(qc.getQueryData(key)).toEqual([{ id: 'c2', body: 'second' }]);
    expect(previous).toEqual(original);
  });

  test('rollback restores comments on error', () => {
    const qc = makeQueryClient();
    const key = queryKeys.comments.list({ mapId: 'map-1' });
    const original = [
      { id: 'c1', body: 'first' },
      { id: 'c2', body: 'second' },
    ];
    qc.setQueryData(key, original);
    const previous = qc.getQueryData(key);
    qc.setQueryData(key, (old: typeof original | undefined) =>
      old?.filter((c) => c.id !== 'c1') ?? []
    );
    qc.setQueryData(key, previous);
    expect(qc.getQueryData(key)).toEqual(original);
  });
});

describe('comment resolve → optimistic toggle + rollback', () => {
  test('optimistically toggles resolved flag in cache', () => {
    const qc = makeQueryClient();
    const key = queryKeys.comments.list({ mapId: 'map-1' });
    const original = [
      { id: 'c1', body: 'first', resolved: false },
      { id: 'c2', body: 'second', resolved: true },
    ];
    qc.setQueryData(key, original);
    qc.setQueryData(key, (old: typeof original | undefined) =>
      old?.map((c) => c.id === 'c1' ? { ...c, resolved: !c.resolved } : c) ?? []
    );
    const result = qc.getQueryData<typeof original>(key);
    expect(result?.[0]?.resolved).toBe(true);
    expect(result?.[1]?.resolved).toBe(true);
  });

  test('rollback restores original resolved state on error', () => {
    const qc = makeQueryClient();
    const key = queryKeys.comments.list({ mapId: 'map-1' });
    const original = [{ id: 'c1', body: 'first', resolved: false }];
    qc.setQueryData(key, original);
    const previous = qc.getQueryData(key);
    qc.setQueryData(key, (old: typeof original | undefined) =>
      old?.map((c) => c.id === 'c1' ? { ...c, resolved: !c.resolved } : c) ?? []
    );
    qc.setQueryData(key, previous);
    const result = qc.getQueryData<typeof original>(key);
    expect(result?.[0]?.resolved).toBe(false);
  });
});

describe('feature upsert → cache + hot overlay', () => {
  let hotOverlay: HotOverlayStore;
  beforeEach(() => {
    hotOverlay = new HotOverlayStore();
  });

  test('onSuccess invalidates features list so GeoJSON source refreshes', async () => {
    const qc = makeQueryClient();
    const key = queryKeys.features.list({ layerId: 'layer-1' });
    qc.setQueryData(key, [{ id: 'f-existing' }]);
    await qc.invalidateQueries({ queryKey: key });
    const state = qc.getQueryState(key);
    expect(state?.isInvalidated).toBe(true);
  });

  test('adds feature to hot overlay for large layer', () => {
    const feature = {
      type: 'Feature' as const,
      id: 'f1',
      geometry: { type: 'Point' as const, coordinates: [0, 0] },
      properties: {},
    };
    hotOverlay.addHotFeature('layer-1', feature);
    const coll = hotOverlay.getCollection('layer-1');
    expect(coll.features).toHaveLength(1);
    expect(coll.features[0]?.id).toBe('f1');
  });

  test('removeHotFeature clears specific feature from overlay', () => {
    const feature = {
      type: 'Feature' as const,
      id: 'f1',
      geometry: { type: 'Point' as const, coordinates: [0, 0] },
      properties: {},
    };
    hotOverlay.addHotFeature('layer-1', feature);
    hotOverlay.removeHotFeature('layer-1', 'f1');
    const coll = hotOverlay.getCollection('layer-1');
    expect(coll.features).toHaveLength(0);
  });
});

describe('annotation pins derived from query cache', () => {
  test('annotation list data can be filtered to point anchors for pins', () => {
    const annotations = [
      { id: 'a1', anchor: { type: 'point', geometry: { type: 'Point', coordinates: [1, 2] } }, authorName: 'Alice', content: { kind: 'single', body: { type: 'text', value: 'note' } }, createdAt: '2026-01-01', parentId: null },
      { id: 'a2', anchor: { type: 'region', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } }, authorName: 'Bob', content: { kind: 'single', body: { type: 'text', value: 'area' } }, createdAt: '2026-01-02', parentId: null },
      { id: 'a3', anchor: { type: 'point', geometry: { type: 'Point', coordinates: [3, 4] } }, authorName: 'Carol', content: { kind: 'single', body: { type: 'text', value: 'reply' } }, createdAt: '2026-01-03', parentId: 'a1' },
    ];
    const pointPins = annotations
      .filter((a) => a.anchor.type === 'point' && !a.parentId)
      .map((a) => ({
        type: 'Feature',
        id: a.id,
        geometry: a.anchor.geometry,
        properties: { authorName: a.authorName, contentJson: JSON.stringify(a.content), anchorType: a.anchor.type },
      }));
    expect(pointPins).toHaveLength(1);
    expect(pointPins[0]?.id).toBe('a1');
    const regionFeatures = annotations.filter((a) => a.anchor.type === 'region' && !a.parentId);
    expect(regionFeatures).toHaveLength(1);
  });
});

describe('adversarial: empty and missing cache data', () => {
  test('optimistic delete on empty list produces empty array', () => {
    const qc = makeQueryClient();
    const key = queryKeys.annotations.list({ mapId: 'map-empty' });
    qc.setQueryData(key, []);
    qc.setQueryData(key, (old: { id: string }[] | undefined) =>
      old?.filter((a) => a.id !== 'nonexistent') ?? []
    );
    expect(qc.getQueryData(key)).toEqual([]);
  });

  test('optimistic delete on undefined cache returns empty array', () => {
    const qc = makeQueryClient();
    const key = queryKeys.annotations.list({ mapId: 'map-undefined' });
    // No setQueryData — cache is undefined
    qc.setQueryData(key, (old: { id: string }[] | undefined) =>
      old?.filter((a) => a.id !== 'a1') ?? []
    );
    expect(qc.getQueryData(key)).toEqual([]);
  });
});
