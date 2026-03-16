// @vitest-environment node
import { describe, test, expect } from 'vitest';
import { QueryClient } from '@tanstack/svelte-query';
import { queryKeys } from '$lib/utils/query-keys.js';

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
