# TanStack Query Mutation Invalidation — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `@tanstack/svelte-query` to fix 11 broken mutation flows where UI doesn't update after data changes, plus a hot/cold overlay for large vector tile layers.

**Architecture:** Wrap the 11 broken tRPC mutation flows with TanStack Query's `createMutation` + cache invalidation. Queries (`createQuery`) replace manual `loadAnnotations()`/`loadComments()`/`loadLayerData()` functions. Annotation pins in MapEditor become `$derived` from the shared annotations query. Large layers use a hot/cold GeoJSON overlay pattern instead of imperative `setTiles()`. The existing tRPC client is unchanged — new code wraps it, doesn't replace it.

**Tech Stack:** `@tanstack/svelte-query` v5, Svelte 5 runes, existing tRPC client, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-15-tanstack-query-mutation-invalidation-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `apps/web/src/lib/utils/query-client.ts` | QueryClient singleton with default config (staleTime, gcTime, retry) |
| `apps/web/src/lib/utils/query-keys.ts` | Typed query key factory — single source of truth for all cache keys |
| `apps/web/src/lib/utils/map-sources.svelte.ts` | Hot overlay `$state` + helpers (add/remove/clear/getCollection) for large layer mutations |
| `apps/web/src/lib/components/annotations/AnnotationThread.svelte` | Thread sub-component with its own `createQuery` (replaces inline `{#await}`) |
| `apps/web/src/__tests__/query-keys.test.ts` | Query key factory unit tests |
| `apps/web/src/__tests__/map-sources.test.ts` | Hot overlay state unit tests |
| `apps/web/src/__tests__/query-invalidation.test.ts` | Mutation → cache invalidation integration tests |

### Modified Files

| File | Change Summary |
|------|---------------|
| `apps/web/package.json` | Add `@tanstack/svelte-query` dependency |
| `apps/web/src/routes/(app)/+layout.svelte` | Wrap with `QueryClientProvider` |
| `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` | Flows 1-6: replace manual queries/mutations with createQuery/createMutation |
| `apps/web/src/lib/components/map/MapEditor.svelte` | Annotation pins as `$derived` from query, feature query, hot overlay rendering, rename callback |
| `apps/web/src/lib/components/map/DrawingToolbar.svelte` | Flows 7-9: wrap feature upsert/delete/undo/redo in createMutation |
| `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte` | Flow 10: wrap geoprocessing mutation |

### Dependency Graph

```
Chunk 1 (Infrastructure) ──┐
                            ├──→ Chunk 3 (Annotations) ──→ Chunk 4 (Comments)
Chunk 2 (Hot Overlay) ──┐  │
                        ├──┼──→ Chunk 5 (Features)
                        │  │
                        │  └──→ Chunk 6 (Geoprocessing + Pin Reactivity)
                        │
                        └──→ Chunk 5 (Features — hot overlay for large layers)
```

Chunks 1 and 2 are independent (parallelizable). Chunks 3-6 depend on Chunk 1. Chunk 5 additionally depends on Chunk 2.

---

## Chunk 1: Infrastructure

### Task 1: Install `@tanstack/svelte-query`

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install the dependency**

Run from `apps/web/`:
```bash
cd apps/web && npm install @tanstack/svelte-query
```

- [ ] **Step 2: Verify installation**

```bash
cd apps/web && node -e "require('@tanstack/svelte-query')" && echo "OK"
```
Expected: `OK` (no errors)

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json apps/web/package-lock.json
git commit -m "feat: add @tanstack/svelte-query dependency"
```

---

### Task 2: Query Key Factory (TDD)

**Files:**
- Create: `apps/web/src/lib/utils/query-keys.ts`
- Create: `apps/web/src/__tests__/query-keys.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/__tests__/query-keys.test.ts
// @vitest-environment node
import { describe, test, expect } from 'vitest';
import { queryKeys } from '$lib/utils/query-keys.js';

describe('queryKeys', () => {
  describe('annotations', () => {
    test('all returns base key', () => {
      expect(queryKeys.annotations.all).toEqual(['annotations']);
    });

    test('list includes mapId', () => {
      expect(queryKeys.annotations.list({ mapId: 'map-1' }))
        .toEqual(['annotations', 'list', { mapId: 'map-1' }]);
    });

    test('thread includes annotationId', () => {
      expect(queryKeys.annotations.thread({ annotationId: 'ann-1' }))
        .toEqual(['annotations', 'getThread', { annotationId: 'ann-1' }]);
    });

    test('invalidating all clears list and thread keys', () => {
      const allKey = queryKeys.annotations.all;
      const listKey = queryKeys.annotations.list({ mapId: 'map-1' });
      const threadKey = queryKeys.annotations.thread({ annotationId: 'ann-1' });
      // TanStack Query matches by prefix — all starts with 'annotations'
      expect(listKey[0]).toBe(allKey[0]);
      expect(threadKey[0]).toBe(allKey[0]);
    });
  });

  describe('comments', () => {
    test('list includes mapId', () => {
      expect(queryKeys.comments.list({ mapId: 'map-1' }))
        .toEqual(['comments', 'list', { mapId: 'map-1' }]);
    });
  });

  describe('features', () => {
    test('list includes layerId', () => {
      expect(queryKeys.features.list({ layerId: 'layer-1' }))
        .toEqual(['features', 'list', { layerId: 'layer-1' }]);
    });
  });

  describe('layers', () => {
    test('list includes mapId', () => {
      expect(queryKeys.layers.list({ mapId: 'map-1' }))
        .toEqual(['layers', 'list', { mapId: 'map-1' }]);
    });
  });

  test('different mapIds produce different keys', () => {
    const key1 = queryKeys.annotations.list({ mapId: 'map-1' });
    const key2 = queryKeys.annotations.list({ mapId: 'map-2' });
    expect(key1).not.toEqual(key2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run src/__tests__/query-keys.test.ts
```
Expected: FAIL — module `$lib/utils/query-keys.js` not found

- [ ] **Step 3: Implement the query key factory**

```typescript
// apps/web/src/lib/utils/query-keys.ts
export const queryKeys = {
  annotations: {
    all: ['annotations'] as const,
    list: (params: { mapId: string }) =>
      ['annotations', 'list', params] as const,
    thread: (params: { annotationId: string }) =>
      ['annotations', 'getThread', params] as const,
  },
  comments: {
    all: ['comments'] as const,
    list: (params: { mapId: string }) =>
      ['comments', 'list', params] as const,
  },
  features: {
    all: ['features'] as const,
    list: (params: { layerId: string }) =>
      ['features', 'list', params] as const,
  },
  layers: {
    all: ['layers'] as const,
    list: (params: { mapId: string }) =>
      ['layers', 'list', params] as const,
  },
} as const;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run src/__tests__/query-keys.test.ts
```
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/utils/query-keys.ts apps/web/src/__tests__/query-keys.test.ts
git commit -m "feat: add typed query key factory with tests"
```

---

### Task 3: QueryClient Singleton

**Files:**
- Create: `apps/web/src/lib/utils/query-client.ts`

- [ ] **Step 1: Create the QueryClient singleton**

```typescript
// apps/web/src/lib/utils/query-client.ts
import { QueryClient } from '@tanstack/svelte-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,            // 30s — data considered fresh, no refetch on mount
      gcTime: 5 * 60_000,           // 5min — cache retained after unmount
      refetchOnWindowFocus: false,   // avoid surprise refetches mid-editing
      retry: 1,                      // one retry for transient network errors
    },
  },
});
```

- [ ] **Step 2: Verify it compiles**

```bash
cd apps/web && npx tsc --noEmit src/lib/utils/query-client.ts 2>&1 || echo "Check for errors"
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/utils/query-client.ts
git commit -m "feat: add QueryClient singleton with default config"
```

---

### Task 4: QueryClientProvider Setup

**Files:**
- Modify: `apps/web/src/routes/(app)/+layout.svelte`

- [ ] **Step 1: Add QueryClientProvider to app layout**

Current file at `apps/web/src/routes/(app)/+layout.svelte`:
```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    children: Snippet;
    data: { user: { id: string; email: string; name: string; isAdmin: boolean } };
  }

  let { children }: Props = $props();
</script>

{@render children()}
```

Change to:
```svelte
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { QueryClientProvider } from '@tanstack/svelte-query';
  import { queryClient } from '$lib/utils/query-client.js';

  interface Props {
    children: Snippet;
    data: { user: { id: string; email: string; name: string; isAdmin: boolean } };
  }

  let { children }: Props = $props();
</script>

<QueryClientProvider client={queryClient}>
  {@render children()}
</QueryClientProvider>
```

- [ ] **Step 2: Verify the app builds**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/routes/'(app)'/+layout.svelte
git commit -m "feat: add QueryClientProvider to app layout"
```

---

## Chunk 2: Hot Overlay Helpers

### Task 5: Hot Overlay State Module (TDD)

**Files:**
- Create: `apps/web/src/lib/utils/map-sources.svelte.ts`
- Create: `apps/web/src/__tests__/map-sources.test.ts`

Note: The spec says `map-sources.ts` but this file uses Svelte 5 `$state` runes, so it **must** be `.svelte.ts` for the compiler to recognize runes.

- [ ] **Step 1: Write the failing tests**

```typescript
// apps/web/src/__tests__/map-sources.test.ts
// @vitest-environment node
import { describe, test, expect, beforeEach } from 'vitest';
import { hotOverlay } from '$lib/utils/map-sources.svelte.js';

describe('hotOverlay', () => {
  beforeEach(() => {
    hotOverlay.clearHotFeatures();
  });

  const makeFeature = (id: string, coords: [number, number] = [0, 0]) => ({
    type: 'Feature' as const,
    id,
    geometry: { type: 'Point' as const, coordinates: coords },
    properties: {},
  });

  describe('addHotFeature', () => {
    test('adds feature to empty layer', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      const coll = hotOverlay.getCollection('layer-1');
      expect(coll.type).toBe('FeatureCollection');
      expect(coll.features).toHaveLength(1);
      expect(coll.features[0]?.id).toBe('f1');
    });

    test('appends to existing layer features', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.addHotFeature('layer-1', makeFeature('f2'));
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(2);
    });

    test('keeps layers independent', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.addHotFeature('layer-2', makeFeature('f2'));
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(1);
      expect(hotOverlay.getCollection('layer-2').features).toHaveLength(1);
    });
  });

  describe('removeHotFeature', () => {
    test('removes feature by id', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.addHotFeature('layer-1', makeFeature('f2'));
      hotOverlay.removeHotFeature('layer-1', 'f1');
      const coll = hotOverlay.getCollection('layer-1');
      expect(coll.features).toHaveLength(1);
      expect(coll.features[0]?.id).toBe('f2');
    });

    test('no-op when feature not found', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.removeHotFeature('layer-1', 'nonexistent');
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(1);
    });

    test('no-op when layer not found', () => {
      hotOverlay.removeHotFeature('nonexistent', 'f1');
      expect(hotOverlay.getCollection('nonexistent').features).toHaveLength(0);
    });
  });

  describe('setSelectedHotFeature', () => {
    test('adds new feature if not present', () => {
      hotOverlay.setSelectedHotFeature('layer-1', makeFeature('f1'));
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(1);
    });

    test('replaces existing feature with same id', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1', [0, 0]));
      hotOverlay.setSelectedHotFeature('layer-1', makeFeature('f1', [1, 1]));
      const coll = hotOverlay.getCollection('layer-1');
      expect(coll.features).toHaveLength(1);
      expect((coll.features[0]?.geometry as { coordinates: number[] }).coordinates).toEqual([1, 1]);
    });
  });

  describe('clearHotFeatures', () => {
    test('clears specific layer', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.addHotFeature('layer-2', makeFeature('f2'));
      hotOverlay.clearHotFeatures('layer-1');
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(0);
      expect(hotOverlay.getCollection('layer-2').features).toHaveLength(1);
    });

    test('clears all layers when no arg', () => {
      hotOverlay.addHotFeature('layer-1', makeFeature('f1'));
      hotOverlay.addHotFeature('layer-2', makeFeature('f2'));
      hotOverlay.clearHotFeatures();
      expect(hotOverlay.getCollection('layer-1').features).toHaveLength(0);
      expect(hotOverlay.getCollection('layer-2').features).toHaveLength(0);
    });
  });

  describe('getCollection', () => {
    test('returns empty FeatureCollection for unknown layer', () => {
      const coll = hotOverlay.getCollection('nonexistent');
      expect(coll).toEqual({ type: 'FeatureCollection', features: [] });
    });
  });

  test('adversarial: rapid add/remove/clear cycle', () => {
    for (let i = 0; i < 100; i++) {
      hotOverlay.addHotFeature('layer-1', makeFeature(`f${i}`));
    }
    for (let i = 0; i < 50; i++) {
      hotOverlay.removeHotFeature('layer-1', `f${i}`);
    }
    expect(hotOverlay.getCollection('layer-1').features).toHaveLength(50);
    hotOverlay.clearHotFeatures('layer-1');
    expect(hotOverlay.getCollection('layer-1').features).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run src/__tests__/map-sources.test.ts
```
Expected: FAIL — module `$lib/utils/map-sources.svelte.js` not found

- [ ] **Step 3: Implement the hot overlay module**

```typescript
// apps/web/src/lib/utils/map-sources.svelte.ts
import type { Feature, FeatureCollection } from 'geojson';

let _hotFeatures = $state<Record<string, Feature[]>>({});

export const hotOverlay = {
  /** Get the hot features record (for reactive template bindings). */
  get features() {
    return _hotFeatures;
  },

  /** Get a GeoJSON FeatureCollection for a specific layer. */
  getCollection(layerId: string): FeatureCollection {
    return {
      type: 'FeatureCollection',
      features: _hotFeatures[layerId] ?? [],
    };
  },

  /** Add a just-drawn/upserted feature to the hot overlay. */
  addHotFeature(layerId: string, feature: Feature) {
    const existing = _hotFeatures[layerId] ?? [];
    _hotFeatures = { ..._hotFeatures, [layerId]: [...existing, feature] };
  },

  /** Remove a feature from the hot overlay (after undo/delete). */
  removeHotFeature(layerId: string, featureId: string) {
    const existing = _hotFeatures[layerId];
    if (!existing) return;
    _hotFeatures = {
      ..._hotFeatures,
      [layerId]: existing.filter((f) => String(f.id) !== featureId),
    };
  },

  /**
   * Set the selected feature in the hot overlay — replaces if exists, adds if not.
   * Ensures just-edited features on large layers are visible even if Martin tiles
   * haven't updated yet (mirrors Mapbox GL Draw's hot/cold selection pattern).
   */
  setSelectedHotFeature(layerId: string, feature: Feature) {
    const existing = (_hotFeatures[layerId] ?? []).filter(
      (f) => String(f.id) !== String(feature.id)
    );
    _hotFeatures = { ..._hotFeatures, [layerId]: [...existing, feature] };
  },

  /** Clear hot features for a specific layer, or all layers if no arg. */
  clearHotFeatures(layerId?: string) {
    if (layerId !== undefined) {
      const { [layerId]: _, ...rest } = _hotFeatures;
      _hotFeatures = rest;
    } else {
      _hotFeatures = {};
    }
  },
};
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run src/__tests__/map-sources.test.ts
```
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/utils/map-sources.svelte.ts apps/web/src/__tests__/map-sources.test.ts
git commit -m "feat: add hot overlay state module with tests"
```

---

## Chunk 3: Annotation Mutations (Flows 1-3a)

> **Prerequisite:** Chunk 1 complete (query-keys, query-client, provider).

### Task 6: AnnotationPanel — Replace Manual Queries with createQuery

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte`

This task replaces the manual `loadAnnotations()` and `loadComments()` functions with `createQuery` calls. No mutation changes yet — just the read side.

- [ ] **Step 1: Add imports and create queries at top-level**

At the top of `AnnotationPanel.svelte`'s `<script>` block, add:
```typescript
import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
import { queryKeys } from '$lib/utils/query-keys.js';
```

Replace:
```typescript
let annotationList = $state<AnnotationObject[]>([]);
let listLoading = $state(false);
let listError = $state<string | null>(null);

async function loadAnnotations() {
  listLoading = true;
  listError = null;
  try {
    annotationList = await trpc.annotations.list.query({ mapId });
    oncountchange?.(annotationList.length, comments.length);
  } catch (err: unknown) {
    listError = (err as { message?: string })?.message ?? 'Failed to load annotations.';
  } finally {
    listLoading = false;
  }
}
```

With:
```typescript
const queryClient = useQueryClient();

const annotationsQuery = createQuery(() => ({
  queryKey: queryKeys.annotations.list({ mapId }),
  queryFn: () => trpc.annotations.list.query({ mapId }),
}));

const annotationList = $derived(annotationsQuery.data ?? []);
const listLoading = $derived(annotationsQuery.isPending);
const listError = $derived(annotationsQuery.error?.message ?? null);
```

- [ ] **Step 2: Replace comments query similarly**

Replace:
```typescript
let comments = $state<CommentEntry[]>([]);
```
and `loadComments()` with:
```typescript
const commentsQuery = createQuery(() => ({
  queryKey: queryKeys.comments.list({ mapId }),
  queryFn: async () => {
    const rows = await trpc.comments.list.query({ mapId });
    return rows as CommentEntry[];
  },
}));

const comments = $derived(commentsQuery.data ?? []);
```

- [ ] **Step 3: Remove the `$effect` that called loadAnnotations/loadComments**

Delete this block (createQuery handles initial fetch automatically):
```typescript
$effect(() => {
  const _mapId = mapId;
  untrack(() => {
    loadAnnotations();
    loadComments();
  });
});
```

- [ ] **Step 4: Update oncountchange to use derived data**

Add an effect to fire oncountchange when data changes:
```typescript
$effect(() => {
  oncountchange?.(annotationList.length, comments.length);
});
```

- [ ] **Step 5: Verify the app builds and annotation list still renders**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte
git commit -m "refactor: replace manual annotation/comment loading with createQuery"
```

---

### Task 7: Flow 1 — Annotation Create Mutation

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte`
- Modify: `apps/web/src/__tests__/query-invalidation.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/src/__tests__/query-invalidation.test.ts
// @vitest-environment node
import { describe, test, expect, vi, beforeEach } from 'vitest';
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

    // Simulate what the createAnnotation mutation's onSuccess does
    await qc.invalidateQueries({ queryKey: key });

    // Cache is marked stale — TanStack will refetch on next observer mount
    const state = qc.getQueryState(key);
    expect(state?.isInvalidated).toBe(true);
  });

  test('invalidating annotations.all also invalidates annotations.list', async () => {
    const qc = makeQueryClient();
    const listKey = queryKeys.annotations.list({ mapId: 'map-1' });
    qc.setQueryData(listKey, [{ id: 'existing' }]);

    // Broader invalidation should also mark the list stale
    await qc.invalidateQueries({ queryKey: queryKeys.annotations.all });

    const state = qc.getQueryState(listKey);
    expect(state?.isInvalidated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** (module not yet wired — ensures test isn't trivially passing)

```bash
cd apps/web && npx vitest run src/__tests__/query-invalidation.test.ts
```
Expected: PASS (these test QueryClient cache operations directly, not component wiring — they validate the cache manipulation patterns that mutations will use)

- [ ] **Step 3: Add createMutation for annotation create in AnnotationPanel**

Add after the `annotationsQuery` definition:
```typescript
const createAnnotationMutation = createMutation(() => ({
  mutationFn: (input: { mapId: string; anchor: Anchor; content: { kind: 'single'; body: AC } }) =>
    trpc.annotations.create.mutate(input),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.annotations.list({ mapId }) });
  },
}));
```

- [ ] **Step 4: Replace the create call in handleCreate**

In the `handleCreate` function, replace:
```typescript
await trpc.annotations.create.mutate({
  mapId,
  anchor,
  content: { kind: 'single', body: content },
});

showForm = false;
resetForm();
await loadAnnotations();
onannotationchange('created');
```

With:
```typescript
await createAnnotationMutation.mutateAsync({
  mapId,
  anchor,
  content: { kind: 'single', body: content },
});

showForm = false;
resetForm();
// Query invalidation handles the list refresh — no manual loadAnnotations()
onannotationchange('created');
```

Also replace the `creating` state management. The mutation has its own `isPending`:
- Replace `creating = true` / `creating = false` with using `createAnnotationMutation.isPending` in the template where `creating` is referenced.
- Or keep `creating` as a local guard for the form UI and set it from the mutation lifecycle:

```typescript
creating = true;
try {
  await createAnnotationMutation.mutateAsync({ mapId, anchor, content: { kind: 'single', body: content } });
  showForm = false;
  resetForm();
  onannotationchange('created');
} catch (err: unknown) {
  createError = (err as { message?: string })?.message ?? 'Failed to create annotation.';
} finally {
  creating = false;
  uploading = false;
}
```

- [ ] **Step 5: Handle the measurement annotation create flow too**

Find the second `trpc.annotations.create.mutate` call (for measurement annotations, around line 475) and replace it with the same mutation:
```typescript
await createAnnotationMutation.mutateAsync({
  mapId,
  anchor: pendingMeasurementData.anchor,
  content: { kind: 'single', body: pendingMeasurementData.content },
});
// Remove: await loadAnnotations();
onannotationchange('created');
```

- [ ] **Step 6: Verify build**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte apps/web/src/__tests__/query-invalidation.test.ts
git commit -m "feat: Flow 1 — annotation create uses createMutation with cache invalidation"
```

---

### Task 8: Flow 2 — Annotation Delete Mutation (Optimistic)

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte`
- Modify: `apps/web/src/__tests__/query-invalidation.test.ts`

- [ ] **Step 1: Write the failing tests for optimistic delete + rollback**

Add to `query-invalidation.test.ts`:
```typescript
describe('annotation delete → optimistic + rollback', () => {
  test('optimistically removes annotation from cache', () => {
    const qc = makeQueryClient();
    const key = queryKeys.annotations.list({ mapId: 'map-1' });
    const original = [{ id: 'a1', mapId: 'map-1' }, { id: 'a2', mapId: 'map-1' }];
    qc.setQueryData(key, original);

    // Simulate onMutate: remove a1
    const previous = qc.getQueryData(key);
    qc.setQueryData(key, (old: typeof original | undefined) =>
      old?.filter((a) => a.id !== 'a1') ?? []
    );

    expect(qc.getQueryData(key)).toEqual([{ id: 'a2', mapId: 'map-1' }]);
    // Verify previous snapshot for rollback
    expect(previous).toEqual(original);
  });

  test('rollback restores previous cache on error', () => {
    const qc = makeQueryClient();
    const key = queryKeys.annotations.list({ mapId: 'map-1' });
    const original = [{ id: 'a1', mapId: 'map-1' }, { id: 'a2', mapId: 'map-1' }];
    qc.setQueryData(key, original);

    // Simulate onMutate
    const previous = qc.getQueryData(key);
    qc.setQueryData(key, (old: typeof original | undefined) =>
      old?.filter((a) => a.id !== 'a1') ?? []
    );

    // Simulate onError: rollback
    qc.setQueryData(key, previous);

    expect(qc.getQueryData(key)).toEqual(original);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/web && npx vitest run src/__tests__/query-invalidation.test.ts
```
Expected: PASS

- [ ] **Step 3: Add optimistic delete mutation to AnnotationPanel**

```typescript
const deleteAnnotationMutation = createMutation(() => ({
  mutationFn: (input: { id: string }) =>
    trpc.annotations.delete.mutate(input),
  onMutate: async ({ id }) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.annotations.list({ mapId }) });
    const previous = queryClient.getQueryData<AnnotationObject[]>(
      queryKeys.annotations.list({ mapId })
    );
    queryClient.setQueryData<AnnotationObject[]>(
      queryKeys.annotations.list({ mapId }),
      (old) => old?.filter((a) => a.id !== id) ?? []
    );
    return { previous };
  },
  onError: (_err: unknown, _vars: { id: string }, context: { previous?: AnnotationObject[] } | undefined) => {
    if (context?.previous) {
      queryClient.setQueryData(queryKeys.annotations.list({ mapId }), context.previous);
    }
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.annotations.list({ mapId }) });
  },
}));
```

- [ ] **Step 4: Replace handleDelete**

Replace:
```typescript
async function handleDelete(id: string) {
  try {
    await trpc.annotations.delete.mutate({ id });
    await loadAnnotations();
    onannotationchange('deleted');
  } catch (err: unknown) {
    listError = (err as { message?: string })?.message ?? 'Failed to delete annotation.';
  }
}
```

With:
```typescript
async function handleDelete(id: string) {
  try {
    await deleteAnnotationMutation.mutateAsync({ id });
    onannotationchange('deleted');
  } catch (err: unknown) {
    // Rollback handled by onError — just show toast for user feedback
    toastStore.error((err as { message?: string })?.message ?? 'Failed to delete annotation.');
  }
}
```

- [ ] **Step 5: Verify build**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte apps/web/src/__tests__/query-invalidation.test.ts
git commit -m "feat: Flow 2 — annotation delete with optimistic removal and rollback"
```

---

### Task 9: Flow 3 — Annotation Reply + Thread Component

**Files:**
- Create: `apps/web/src/lib/components/annotations/AnnotationThread.svelte`
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte`

- [ ] **Step 1: Create the AnnotationThread component**

This replaces the inline `{#await trpc.annotations.getThread.query(...)}` with a `createQuery` so the thread participates in the cache and auto-refreshes when invalidated.

```svelte
<!-- apps/web/src/lib/components/annotations/AnnotationThread.svelte -->
<script lang="ts">
  import { createQuery } from '@tanstack/svelte-query';
  import { trpc } from '$lib/utils/trpc.js';
  import { queryKeys } from '$lib/utils/query-keys.js';
  import AnnotationContent from './AnnotationContent.svelte';
  import type { AnnotationObject } from '@felt-like-it/shared-types';

  interface Props {
    annotationId: string;
    userId?: string;
    ondelete?: (id: string) => void;
  }

  let { annotationId, userId, ondelete }: Props = $props();

  const threadQuery = createQuery(() => ({
    queryKey: queryKeys.annotations.thread({ annotationId }),
    queryFn: () => trpc.annotations.getThread.query({ rootId: annotationId }),
  }));
</script>

{#if threadQuery.isPending}
  <p class="text-xs text-slate-500 pl-4">Loading replies…</p>
{:else if threadQuery.error}
  <p class="text-xs text-red-400 pl-4">Failed to load replies.</p>
{:else if threadQuery.data}
  {#each threadQuery.data.replies ?? [] as reply (reply.id)}
    <div class="pl-4 border-l border-white/10">
      <AnnotationContent
        annotation={reply}
        {userId}
        ondelete={() => ondelete?.(reply.id)}
      />
    </div>
  {/each}
{/if}
```

**Important:** Before writing this component, read the `{#await trpc.annotations.getThread.query(...)}` block in AnnotationPanel (search for `getThread` in the template section). Copy the exact reply rendering markup (classes, props, structure) into this component, replacing only the data source (from `{#await}` to `threadQuery.data`). After implementing, visually verify that expanded threads render identically to the current behavior.

- [ ] **Step 2: Add reply mutation to AnnotationPanel**

```typescript
const replyAnnotationMutation = createMutation(() => ({
  mutationFn: (input: { mapId: string; parentId: string; anchor: Anchor; content: { kind: 'single'; body: AC } }) =>
    trpc.annotations.create.mutate(input),
  onSuccess: (_data: unknown, variables: { parentId: string }) => {
    queryClient.invalidateQueries({ queryKey: queryKeys.annotations.list({ mapId }) });
    queryClient.invalidateQueries({
      queryKey: queryKeys.annotations.thread({ annotationId: variables.parentId }),
    });
  },
}));
```

- [ ] **Step 3: Replace inline `{#await}` thread block with AnnotationThread component**

In AnnotationPanel's template, find the `{#await trpc.annotations.getThread.query(...)}` block and replace with:
```svelte
<AnnotationThread
  annotationId={annotation.id}
  {userId}
  ondelete={handleDelete}
/>
```

Add the import at the top:
```typescript
import AnnotationThread from './AnnotationThread.svelte';
```

- [ ] **Step 4: Wire reply form to use the mutation**

Find where annotation replies are submitted (the reply form in the expanded annotation section) and replace the direct `trpc.annotations.create.mutate()` call with:
```typescript
await replyAnnotationMutation.mutateAsync({
  mapId,
  parentId: annotation.id,
  anchor,
  content: { kind: 'single', body: replyContent },
});
```

- [ ] **Step 5: Verify build**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationThread.svelte apps/web/src/lib/components/annotations/AnnotationPanel.svelte
git commit -m "feat: Flow 3 — annotation reply with thread component and cache invalidation"
```

---

### Task 10: Flow 3a — Annotation Update (IIIF NavPlace)

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte`
- Modify: `apps/web/src/__tests__/query-invalidation.test.ts`

- [ ] **Step 1: Add test for annotation update invalidation**

Add to `query-invalidation.test.ts`:
```typescript
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
```

- [ ] **Step 2: Add update mutation**

```typescript
const updateAnnotationMutation = createMutation(() => ({
  mutationFn: (input: { id: string; anchor?: Anchor }) =>
    trpc.annotations.update.mutate(input),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.annotations.list({ mapId }) });
  },
}));
```

- [ ] **Step 3: Replace the IIIF NavPlace update call in handleFetchNavPlace**

Find the `handleFetchNavPlace` function. Replace:
```typescript
await trpc.annotations.update.mutate({
  id: annotation.id,
  anchor: navPlaceAnchor,
});
// ...
onannotationchange();
```

With:
```typescript
await updateAnnotationMutation.mutateAsync({
  id: annotation.id,
  anchor: navPlaceAnchor,
});
// Query invalidation handles refresh — no manual onannotationchange() for data
onannotationchange();
```

- [ ] **Step 4: Verify build**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte apps/web/src/__tests__/query-invalidation.test.ts
git commit -m "feat: Flow 3a — annotation IIIF update uses createMutation"
```

---

## Chunk 4: Comment Mutations (Flows 4-6)

> **Prerequisite:** Task 6 complete (commentsQuery already created).

### Task 11: Flow 4 — Comment Create Mutation

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte`
- Modify: `apps/web/src/__tests__/query-invalidation.test.ts`

- [ ] **Step 1: Add test for comment create invalidation**

Add to `query-invalidation.test.ts`:
```typescript
describe('comment create → invalidation', () => {
  test('onSuccess invalidates comment list so next read is fresh', async () => {
    const qc = makeQueryClient();
    const key = queryKeys.comments.list({ mapId: 'map-1' });
    qc.setQueryData(key, [{ id: 'c1' }]);

    // Simulate what createCommentMutation's onSuccess does
    await qc.invalidateQueries({ queryKey: key });

    const state = qc.getQueryState(key);
    expect(state?.isInvalidated).toBe(true);
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd apps/web && npx vitest run src/__tests__/query-invalidation.test.ts
```
Expected: PASS

- [ ] **Step 3: Add createMutation for comment create**

```typescript
const createCommentMutation = createMutation(() => ({
  mutationFn: (input: { mapId: string; body: string }) =>
    trpc.comments.create.mutate(input),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.comments.list({ mapId }) });
  },
}));
```

- [ ] **Step 4: Replace handleCommentSubmit**

Replace:
```typescript
async function handleCommentSubmit() {
  const body = commentBody.trim();
  if (!body) return;
  submittingComment = true;
  try {
    await trpc.comments.create.mutate({ mapId, body });
    commentBody = '';
    await loadComments();
  } catch {
    toastStore.error('Failed to post comment.');
  } finally {
    submittingComment = false;
  }
}
```

With:
```typescript
async function handleCommentSubmit() {
  const body = commentBody.trim();
  if (!body) return;
  submittingComment = true;
  try {
    await createCommentMutation.mutateAsync({ mapId, body });
    commentBody = '';
    // Query invalidation handles refresh
  } catch {
    toastStore.error('Failed to post comment.');
  } finally {
    submittingComment = false;
  }
}
```

- [ ] **Step 5: Verify build**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte apps/web/src/__tests__/query-invalidation.test.ts
git commit -m "feat: Flow 4 — comment create uses createMutation with cache invalidation"
```

---

### Task 12: Flow 5 — Comment Delete Mutation (Optimistic)

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte`
- Modify: `apps/web/src/__tests__/query-invalidation.test.ts`

- [ ] **Step 1: Write the failing test for comment delete + rollback**

Add to `query-invalidation.test.ts`:
```typescript
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

    // Rollback
    qc.setQueryData(key, previous);
    expect(qc.getQueryData(key)).toEqual(original);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/web && npx vitest run src/__tests__/query-invalidation.test.ts
```
Expected: PASS

- [ ] **Step 3: Add optimistic delete mutation for comments**

```typescript
interface CommentEntry {
  id: string;
  mapId: string;
  userId: string | null;
  authorName: string;
  body: string;
  resolved: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const deleteCommentMutation = createMutation(() => ({
  mutationFn: (input: { id: string }) =>
    trpc.comments.delete.mutate(input),
  onMutate: async ({ id }) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.comments.list({ mapId }) });
    const previous = queryClient.getQueryData<CommentEntry[]>(
      queryKeys.comments.list({ mapId })
    );
    queryClient.setQueryData<CommentEntry[]>(
      queryKeys.comments.list({ mapId }),
      (old) => old?.filter((c) => c.id !== id) ?? []
    );
    return { previous };
  },
  onError: (_err: unknown, _vars: { id: string }, context: { previous?: CommentEntry[] } | undefined) => {
    if (context?.previous) {
      queryClient.setQueryData(queryKeys.comments.list({ mapId }), context.previous);
    }
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.comments.list({ mapId }) });
  },
}));
```

Note: The `CommentEntry` interface is already defined in AnnotationPanel — use the existing one. Do not duplicate it.

- [ ] **Step 4: Replace handleCommentDelete**

Replace:
```typescript
async function handleCommentDelete(id: string) {
  try {
    await trpc.comments.delete.mutate({ id });
    comments = comments.filter((c) => c.id !== id);
    oncountchange?.(annotationList.length, comments.length);
  } catch {
    toastStore.error('Failed to delete comment.');
  }
}
```

With:
```typescript
async function handleCommentDelete(id: string) {
  try {
    await deleteCommentMutation.mutateAsync({ id });
    // Optimistic update + invalidation handles refresh and count
  } catch {
    toastStore.error('Failed to delete comment.');
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte apps/web/src/__tests__/query-invalidation.test.ts
git commit -m "feat: Flow 5 — comment delete with optimistic removal and rollback"
```

---

### Task 13: Flow 6 — Comment Resolve Mutation (Optimistic)

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte`
- Modify: `apps/web/src/__tests__/query-invalidation.test.ts`

- [ ] **Step 1: Write tests for optimistic resolve toggle + rollback**

Add to `query-invalidation.test.ts`:
```typescript
describe('comment resolve → optimistic toggle + rollback', () => {
  test('optimistically toggles resolved flag in cache', () => {
    const qc = makeQueryClient();
    const key = queryKeys.comments.list({ mapId: 'map-1' });
    const original = [
      { id: 'c1', body: 'first', resolved: false },
      { id: 'c2', body: 'second', resolved: true },
    ];
    qc.setQueryData(key, original);

    // Simulate onMutate: toggle c1 resolved
    qc.setQueryData(key, (old: typeof original | undefined) =>
      old?.map((c) => c.id === 'c1' ? { ...c, resolved: !c.resolved } : c) ?? []
    );

    const result = qc.getQueryData<typeof original>(key);
    expect(result?.[0]?.resolved).toBe(true);
    expect(result?.[1]?.resolved).toBe(true); // c2 unchanged
  });

  test('rollback restores original resolved state on error', () => {
    const qc = makeQueryClient();
    const key = queryKeys.comments.list({ mapId: 'map-1' });
    const original = [
      { id: 'c1', body: 'first', resolved: false },
    ];
    qc.setQueryData(key, original);

    const previous = qc.getQueryData(key);
    qc.setQueryData(key, (old: typeof original | undefined) =>
      old?.map((c) => c.id === 'c1' ? { ...c, resolved: !c.resolved } : c) ?? []
    );

    // Rollback
    qc.setQueryData(key, previous);
    const result = qc.getQueryData<typeof original>(key);
    expect(result?.[0]?.resolved).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/web && npx vitest run src/__tests__/query-invalidation.test.ts
```
Expected: PASS

- [ ] **Step 3: Add optimistic resolve mutation**

```typescript
const resolveCommentMutation = createMutation(() => ({
  mutationFn: (input: { id: string }) =>
    trpc.comments.resolve.mutate(input),
  onMutate: async ({ id }) => {
    await queryClient.cancelQueries({ queryKey: queryKeys.comments.list({ mapId }) });
    const previous = queryClient.getQueryData<CommentEntry[]>(
      queryKeys.comments.list({ mapId })
    );
    queryClient.setQueryData<CommentEntry[]>(
      queryKeys.comments.list({ mapId }),
      (old) => old?.map((c) => c.id === id ? { ...c, resolved: !c.resolved } : c) ?? []
    );
    return { previous };
  },
  onError: (_err: unknown, _vars: { id: string }, context: { previous?: CommentEntry[] } | undefined) => {
    if (context?.previous) {
      queryClient.setQueryData(queryKeys.comments.list({ mapId }), context.previous);
    }
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.comments.list({ mapId }) });
  },
}));
```

- [ ] **Step 4: Replace handleCommentResolve**

Replace:
```typescript
async function handleCommentResolve(id: string) {
  try {
    const updated = await trpc.comments.resolve.mutate({ id });
    comments = comments.map((c) => (c.id === id ? (updated as CommentEntry) : c));
  } catch {
    toastStore.error('Failed to resolve comment.');
  }
}
```

With:
```typescript
async function handleCommentResolve(id: string) {
  try {
    await resolveCommentMutation.mutateAsync({ id });
    // Optimistic toggle + server reconciliation via onSettled
  } catch {
    toastStore.error('Failed to resolve comment.');
  }
}
```

- [ ] **Step 5: Verify build**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/annotations/AnnotationPanel.svelte apps/web/src/__tests__/query-invalidation.test.ts
git commit -m "feat: Flow 6 — comment resolve with optimistic toggle and rollback"
```

---

## Chunk 5: Feature/Drawing Mutations (Flows 7-9)

> **Prerequisites:** Chunk 1 (infrastructure) and Chunk 2 (hot overlay) complete.

### Task 14: DrawingToolbar — Feature Upsert Mutation (Flows 7-8)

**Files:**
- Modify: `apps/web/src/lib/components/map/DrawingToolbar.svelte`
- Modify: `apps/web/src/__tests__/query-invalidation.test.ts`

- [ ] **Step 1: Write test for feature upsert + hot overlay on large layer**

Add to `query-invalidation.test.ts`:
```typescript
import { hotOverlay } from '$lib/utils/map-sources.svelte.js';

describe('feature upsert → cache + hot overlay', () => {
  beforeEach(() => {
    hotOverlay.clearHotFeatures();
  });

  test('onSuccess invalidates features list so GeoJSON source refreshes', async () => {
    const qc = makeQueryClient();
    const key = queryKeys.features.list({ layerId: 'layer-1' });
    qc.setQueryData(key, [{ id: 'f-existing' }]);

    // Simulate what featureUpsertMutation's onSuccess does
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
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/web && npx vitest run src/__tests__/query-invalidation.test.ts
```

- [ ] **Step 3: Add imports and mutations to DrawingToolbar**

At the top of `DrawingToolbar.svelte`'s `<script>`:
```typescript
import { createMutation, useQueryClient } from '@tanstack/svelte-query';
import { queryKeys } from '$lib/utils/query-keys.js';
import { hotOverlay } from '$lib/utils/map-sources.svelte.js';
```

Add the mutation:
```typescript
const queryClient = useQueryClient();

const featureUpsertMutation = createMutation(() => ({
  mutationFn: (input: { layerId: string; features: { geometry: Record<string, unknown>; properties: Record<string, unknown> }[] }) =>
    trpc.features.upsert.mutate(input),
  onSuccess: (_data: { upsertedIds: string[] }, variables: { layerId: string }) => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.features.list({ layerId: variables.layerId }),
    });
  },
}));

const featureDeleteMutation = createMutation(() => ({
  mutationFn: (input: { layerId: string; ids: string[] }) =>
    trpc.features.delete.mutate(input),
  onSuccess: (_data: unknown, variables: { layerId: string }) => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.features.list({ layerId: variables.layerId }),
    });
  },
}));
```

- [ ] **Step 4: Replace the feature save logic in the Terra Draw finish handler**

Find the section where features are saved after drawing (the `trpc.features.upsert.mutate()` call). Replace:
```typescript
const { upsertedIds } = await trpc.features.upsert.mutate({
  layerId: activeLayer.id,
  features: [{ geometry, properties }],
});
```

With:
```typescript
const { upsertedIds } = await featureUpsertMutation.mutateAsync({
  layerId: activeLayer.id,
  features: [{ geometry, properties }],
});
```

- [ ] **Step 5: Update undo/redo commands to use mutations**

Replace the `undoStore.push` block:
```typescript
undoStore.push({
  description: `Draw ${f.geometry.type}`,
  undo: async () => {
    if (upsertedIds[0]) {
      await trpc.features.delete.mutate({ layerId: activeLayer.id, ids: [upsertedIds[0]] });
    }
  },
  redo: async () => {
    await trpc.features.upsert.mutate({
      layerId: activeLayer.id,
      features: [{ geometry, properties }],
    });
  },
});
```

With:
```typescript
undoStore.push({
  description: `Draw ${f.geometry.type}`,
  undo: async () => {
    if (upsertedIds[0]) {
      await featureDeleteMutation.mutateAsync({ layerId: activeLayer.id, ids: [upsertedIds[0]] });
      hotOverlay.removeHotFeature(activeLayer.id, upsertedIds[0]);
    }
  },
  redo: async () => {
    const result = await featureUpsertMutation.mutateAsync({
      layerId: activeLayer.id,
      features: [{ geometry, properties }],
    });
    if (result.upsertedIds[0]) {
      hotOverlay.addHotFeature(activeLayer.id, {
        type: 'Feature',
        id: result.upsertedIds[0],
        geometry: geometry as GeoJSON.Geometry,
        properties: properties as GeoJSON.GeoJsonProperties,
      });
    }
  },
});
```

- [ ] **Step 6: Add hot overlay update after successful draw on large layer**

After the `upsertedIds` are received and before `onfeaturedrawn`, add:
```typescript
// If this is a large layer, add to hot overlay for immediate visibility
if (upsertedIds[0]) {
  hotOverlay.addHotFeature(activeLayer.id, {
    type: 'Feature',
    id: upsertedIds[0],
    geometry: geometry as GeoJSON.Geometry,
    properties: properties as GeoJSON.GeoJsonProperties,
  });
}
```

The `onfeaturedrawn` callback is kept for interaction state (selecting the drawn feature). MapEditor's `handleFeatureDrawn` will be updated in the next chunk to use query-driven data refresh.

- [ ] **Step 7: Verify build**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/components/map/DrawingToolbar.svelte apps/web/src/__tests__/query-invalidation.test.ts
git commit -m "feat: Flows 7-9 — feature draw/undo/redo with createMutation and hot overlay"
```

---

### Task 15: MapEditor — Feature Query + Hot Overlay Rendering

**Files:**
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`

- [ ] **Step 1: Add imports**

```typescript
import { createQuery, useQueryClient } from '@tanstack/svelte-query';
import { queryKeys } from '$lib/utils/query-keys.js';
import { hotOverlay } from '$lib/utils/map-sources.svelte.js';
```

- [ ] **Step 2: Add feature list query for active layer**

Replace the manual `loadLayerData` function with a reactive query. Add at top-level `<script>`:

```typescript
const mapQueryClient = useQueryClient();

// Feature data for the active (non-large) layer
const activeFeaturesQuery = createQuery(() => ({
  queryKey: queryKeys.features.list({ layerId: layersStore.activeLayerId ?? '' }),
  queryFn: () => trpc.features.list.query({ layerId: layersStore.activeLayerId! }),
  enabled: !!layersStore.activeLayerId && !isLargeLayer(layersStore.active!),
}));
```

Derive the GeoJSON source data from the query. Find the existing `loadLayerData` function and the `$state` variable it populates (likely a GeoJSON FeatureCollection used by MapCanvas). Replace the manual state + loading function with:

```typescript
// Derive GeoJSON FeatureCollection from the active layer's feature query
const activeLayerGeoJSON = $derived<{ type: 'FeatureCollection'; features: { type: 'Feature'; id?: string; geometry: unknown; properties: Record<string, unknown> }[] }>({
  type: 'FeatureCollection',
  features: (activeFeaturesQuery.data ?? []).map((f) => ({
    type: 'Feature' as const,
    id: f.id,
    geometry: f.geometry,
    properties: f.properties ?? {},
  })),
});
```

Then update the MapCanvas/GeoJSONSource binding to use `activeLayerGeoJSON` instead of the old state variable. Read `loadLayerData` to confirm the exact transform and variable name being replaced.

- [ ] **Step 3: Update handleFeatureDrawn for hot overlay on large layers**

In the `handleFeatureDrawn` function, the current logic:
```typescript
if (!drawnLayer || !isLargeLayer(drawnLayer)) {
  await loadLayerData(layerId);
}
```

Replace with:
```typescript
if (!drawnLayer || !isLargeLayer(drawnLayer)) {
  // Small layer: query invalidation handles refresh automatically
  mapQueryClient.invalidateQueries({
    queryKey: queryKeys.features.list({ layerId }),
  });
}
// Large layer: DrawingToolbar already added to hot overlay — no action needed here
```

- [ ] **Step 4: Render hot overlay GeoJSON sources for large layers in the template**

In MapEditor's template, where MapCanvas is rendered, add hot overlay sources for each active large layer. The hot overlay should render with the same styling as the cold tile layer:

Read the existing MapEditor template to find the `svelte-maplibre-gl` components used for GeoJSON sources (likely `GeoJSONSource` and layer components like `FillLayer`, `LineLayer`, `CircleLayer`). Add the hot overlay sources near the existing layer rendering:

```svelte
{#each layersStore.all.filter(l => isLargeLayer(l) && l.visible) as layer (layer.id)}
  {@const hotColl = hotOverlay.getCollection(layer.id)}
  {#if hotColl.features.length > 0}
    <GeoJSONSource id="hot-overlay-{layer.id}" data={hotColl}>
      <!-- Mixed geometry sublayers — same pattern as cold tile layers (see mulch: mx-894289) -->
      <FillLayer
        id="hot-fill-{layer.id}"
        filter={['==', ['geometry-type'], 'Polygon']}
        paint={{ 'fill-color': '#3b82f6', 'fill-opacity': 0.3 }}
      />
      <LineLayer
        id="hot-line-{layer.id}"
        filter={['any', ['==', ['geometry-type'], 'LineString'], ['==', ['geometry-type'], 'Polygon']]}
        paint={{ 'line-color': '#3b82f6', 'line-width': 2 }}
      />
      <CircleLayer
        id="hot-circle-{layer.id}"
        filter={['==', ['geometry-type'], 'Point']}
        paint={{ 'circle-radius': 5, 'circle-color': '#3b82f6' }}
      />
    </GeoJSONSource>
  {/if}
{/each}
```

**Important:** The paint values above are defaults. Read the layer's `style` property and apply matching paint if the cold layer has custom styling. The 3-sublayer pattern (Fill+Line+Circle) matches the project's mixed geometry convention (mulch: mx-894289).

- [ ] **Step 5: Clear hot overlay on navigation/layer switch**

Add an effect to clear hot features when the active layer changes or the user navigates away:
```typescript
$effect(() => {
  // When active layer changes, clear hot overlay for the previous layer
  const activeId = layersStore.activeLayerId;
  return () => {
    // Cleanup: clear all hot overlays on unmount
    hotOverlay.clearHotFeatures();
  };
});
```

- [ ] **Step 6: Verify build**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/components/map/MapEditor.svelte
git commit -m "feat: MapEditor feature query + hot overlay rendering for large layers"
```

---

## Chunk 6: Geoprocessing + Pin Reactivity + Cleanup

> **Prerequisite:** Chunks 1, 3 complete.

### Task 16: Flow 10 — Geoprocessing Mutation

**Files:**
- Modify: `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte`

- [ ] **Step 1: Add imports and mutation**

```typescript
import { createMutation, useQueryClient } from '@tanstack/svelte-query';
import { queryKeys } from '$lib/utils/query-keys.js';

const queryClient = useQueryClient();

const geoprocessingMutation = createMutation(() => ({
  mutationFn: (input: { mapId: string; op: GeoprocessingOp; outputLayerName: string }) =>
    trpc.geoprocessing.run.mutate(input),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.layers.list({ mapId }) });
  },
}));
```

- [ ] **Step 2: Replace the mutation call in handleRun**

Replace:
```typescript
const result = await trpc.geoprocessing.run.mutate({
  mapId,
  op: buildOp(),
  outputLayerName: outputName.trim() || defaultName,
});
success = `Created layer "${result.layerName}"`;
onlayercreated(result.layerId);
```

With:
```typescript
const result = await geoprocessingMutation.mutateAsync({
  mapId,
  op: buildOp(),
  outputLayerName: outputName.trim() || defaultName,
});
success = `Created layer "${result.layerName}"`;
// Layer list auto-refreshes via query invalidation
onlayercreated(result.layerId);
```

- [ ] **Step 3: Verify build**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte
git commit -m "feat: Flow 10 — geoprocessing uses createMutation with layer list invalidation"
```

---

### Task 17: Annotation Pin Reactivity in MapEditor

**Files:**
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`
- Modify: `apps/web/src/__tests__/query-invalidation.test.ts`

This is the key architectural change: annotation pins become `$derived` from the shared annotations query cache. No more `loadAnnotationPins()` function or `onannotationchange` data-refresh callback.

- [ ] **Step 1: Write test for pin derivation from query data**

Add to `query-invalidation.test.ts`:
```typescript
describe('annotation pins derived from query cache', () => {
  test('annotation list query data can be filtered to point anchors for pins', () => {
    const annotations = [
      { id: 'a1', anchor: { type: 'point', geometry: { type: 'Point', coordinates: [1, 2] } }, authorName: 'Alice', content: { kind: 'single', body: { type: 'text', value: 'note' } }, createdAt: '2026-01-01', parentId: null },
      { id: 'a2', anchor: { type: 'region', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,0]]] } }, authorName: 'Bob', content: { kind: 'single', body: { type: 'text', value: 'area' } }, createdAt: '2026-01-02', parentId: null },
      { id: 'a3', anchor: { type: 'point', geometry: { type: 'Point', coordinates: [3, 4] } }, authorName: 'Carol', content: { kind: 'single', body: { type: 'text', value: 'reply' } }, createdAt: '2026-01-03', parentId: 'a1' },
    ];

    // Pins = root annotations with point anchors (no parentId)
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

    // Regions = root annotations with region anchors
    const regionFeatures = annotations
      .filter((a) => a.anchor.type === 'region' && !a.parentId);
    expect(regionFeatures).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test**

```bash
cd apps/web && npx vitest run src/__tests__/query-invalidation.test.ts
```
Expected: PASS

- [ ] **Step 3: Verify annotations.list includes replies (spec constraint)**

The spec requires: "Verify the tRPC `annotations.list` endpoint includes replies or adjust the derivation to fetch threads separately."

Check `apps/web/src/lib/server/trpc/routers/annotations.ts` — read the `list` procedure to see if it filters by `parentId IS NULL` or returns all annotations including replies. If it excludes replies, the pin derivation in Step 4 (which filters `!a.parentId`) will still work correctly for pins, but reply annotations won't be in the cache for thread count badges. If replies are excluded, add a note to the AnnotationThread component that it uses its own `createQuery` for thread data (Task 9 already handles this).

```bash
cd apps/web && grep -n 'parentId\|rootsOnly\|where.*parent' src/lib/server/trpc/routers/annotations.ts
```

Document the finding as a code comment in the query definition.

- [ ] **Step 4: Add annotations query to MapEditor**

Add at top-level `<script>` in MapEditor:
```typescript
const annotationsQuery = createQuery(() => ({
  queryKey: queryKeys.annotations.list({ mapId }),
  queryFn: () => trpc.annotations.list.query({ mapId }),
}));
```

- [ ] **Step 5: Derive annotation pins from query data**

Replace the manual `annotationPins` state and `loadAnnotationPins()` function with derived state:

```typescript
const annotationPins = $derived<AnnotationPinCollection>({
  type: 'FeatureCollection',
  features: (annotationsQuery.data ?? [])
    .filter((a) => a.anchor.type === 'point' && !a.parentId)
    .map((a) => ({
      type: 'Feature' as const,
      id: a.id,
      geometry: (a.anchor as { type: 'point'; geometry: { type: 'Point'; coordinates: [number, number] } }).geometry,
      properties: {
        authorName: a.authorName,
        createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
        contentJson: JSON.stringify(a.content),
        anchorType: a.anchor.type,
      },
    })),
});
```

Do the same for `annotationRegions`:
```typescript
const annotationRegions = $derived<AnnotationRegionCollection>({
  type: 'FeatureCollection',
  features: (annotationsQuery.data ?? [])
    .filter((a) => a.anchor.type === 'region' && !a.parentId)
    .map((a) => ({
      type: 'Feature' as const,
      id: a.id,
      geometry: (a.anchor as { type: 'region'; geometry: { type: 'Polygon'; coordinates: number[][][] } }).geometry,
      properties: { annotationId: a.id },
    })),
});
```

Derive `annotatedFeaturesIndex` (feature-anchored annotation badge counts) from query data:
```typescript
const annotatedFeaturesIndex = $derived(() => {
  const featureAnchored = (annotationsQuery.data ?? []).filter(
    (a) => a.anchor.type === 'feature' && !a.parentId
  );
  const featureMap = new Map<string, { layerId: string; count: number }>();
  for (const ann of featureAnchored) {
    const anchor = ann.anchor as { type: 'feature'; featureId: string; layerId: string };
    const existing = featureMap.get(anchor.featureId);
    if (existing) {
      existing.count++;
    } else {
      featureMap.set(anchor.featureId, { layerId: anchor.layerId, count: 1 });
    }
  }
  return featureMap;
});
```

Derive `measurementAnnotationData` (measurement line/polygon GeoJSON for map rendering):
```typescript
const measurementAnnotationData = $derived({
  type: 'FeatureCollection' as const,
  features: (annotationsQuery.data ?? [])
    .filter((a) => a.anchor.type === 'measurement' && !a.parentId)
    .map((ann) => {
      const anchor = ann.anchor as { type: 'measurement'; geometry: { type: string; coordinates: unknown } };
      const body = ann.content.kind === 'single' ? ann.content.body : null;
      const label = body?.type === 'measurement' ? (body as { displayValue: string }).displayValue : '';
      return {
        type: 'Feature' as const,
        geometry: anchor.geometry,
        properties: { id: ann.id, label, annotationId: ann.id },
      };
    }),
});
```

**Note:** These derivations mirror the logic in the existing `loadAnnotationPins()` function. Read that function to verify the exact transform matches before replacing.

- [ ] **Step 6: Remove loadAnnotationPins function and its effect**

Delete:
```typescript
async function loadAnnotationPins() { ... }

$effect(() => { untrack(() => loadAnnotationPins()); });
```

These are replaced by the `createQuery` + `$derived` pattern above.

- [ ] **Step 7: Remove the data-refresh portion of onannotationchange handler**

In MapEditor's template where AnnotationPanel is used, find:
```svelte
onannotationchange={(action) => {
  // ... interaction state transitions ...
  loadAnnotationPins();
}}
```

Remove the `loadAnnotationPins()` call. The annotation pins now auto-update when the query is invalidated by AnnotationPanel's mutations.

- [ ] **Step 8: Verify build**

```bash
cd apps/web && npx vite build 2>&1 | tail -5
```

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/components/map/MapEditor.svelte apps/web/src/__tests__/query-invalidation.test.ts
git commit -m "feat: annotation pins derived from query cache — auto-update on mutations"
```

---

### Task 18: Rename `onannotationchange` → `onannotationsaved` + Final Cleanup

**Files:**
- Modify: `apps/web/src/lib/components/annotations/AnnotationPanel.svelte`
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`

- [ ] **Step 1: Rename the callback prop in AnnotationPanel**

In AnnotationPanel's `Props` interface, rename:
```typescript
// Before:
onannotationchange: (action?: 'created' | 'deleted') => void;
// After:
onannotationsaved: (action?: 'created' | 'deleted') => void;
```

Update the destructure:
```typescript
// Before:
let { ..., onannotationchange, ... }: Props = $props();
// After:
let { ..., onannotationsaved, ... }: Props = $props();
```

Replace all calls inside AnnotationPanel:
```typescript
// Before:
onannotationchange('created');
onannotationchange('deleted');
onannotationchange();
// After:
onannotationsaved('created');
onannotationsaved('deleted');
onannotationsaved();
```

- [ ] **Step 2: Update MapEditor's binding**

In MapEditor's template, rename the prop:
```svelte
<!-- Before: -->
onannotationchange={(action) => { ... }}
<!-- After: -->
onannotationsaved={(action) => {
  // Interaction state transitions ONLY — data refresh is handled by query invalidation
  if (action === 'created') {
    if (interactionState.type === 'drawRegion' || interactionState.type === 'pickFeature') {
      interactionState = { type: 'idle' };
    }
  }
}}
```

- [ ] **Step 3: Remove any remaining `loadAnnotations()` or `loadComments()` calls**

Search the entire `src/` tree for any remaining references to the old loading functions or callback name:
```bash
cd apps/web && grep -rn 'loadAnnotations\|loadComments\|loadAnnotationPins\|onannotationchange' src/
```

Any hits outside of test files should be removed or updated. Check route files and any other consumers of AnnotationPanel that may pass the old `onannotationchange` prop.

Any hits should be removed or replaced with query invalidation.

- [ ] **Step 4: Remove unused imports**

Clean up any `untrack` imports or other utilities that are no longer needed after removing manual loading functions.

- [ ] **Step 5: Run full test suite**

```bash
cd apps/web && npx vitest run
```
Expected: All existing tests pass + all new tests pass

- [ ] **Step 6: Run full build**

```bash
cd apps/web && npx vite build 2>&1 | tail -10
```
Expected: Build succeeds with no errors

- [ ] **Step 7: Commit**

```bash
git add -u
git commit -m "refactor: rename onannotationchange to onannotationsaved, remove manual loading functions"
```

---

## Verification Checklist

Before marking the feature complete, verify all 11 flows:

| # | Flow | Component | Verify |
|---|------|-----------|--------|
| 1 | Annotation Create | AnnotationPanel | Create annotation → list updates without page refresh |
| 2 | Annotation Delete | AnnotationPanel | Delete → instant removal → server confirms |
| 3 | Annotation Reply | AnnotationPanel + AnnotationThread | Reply → thread refreshes + pin count updates |
| 3a | Annotation Update (IIIF) | AnnotationPanel | Update NavPlace → pin moves on map |
| 4 | Comment Create | AnnotationPanel | Post comment → appears in list |
| 5 | Comment Delete | AnnotationPanel | Delete → instant removal → rollback if error |
| 6 | Comment Resolve | AnnotationPanel | Toggle resolve → instant visual → server confirms |
| 7 | Feature Draw (small) | DrawingToolbar + MapEditor | Draw → feature appears in GeoJSON source |
| 8 | Feature Draw (large) | DrawingToolbar + MapEditor | Draw → feature appears in hot overlay |
| 9 | Feature Undo/Redo | DrawingToolbar | Undo → feature removed + hot overlay updated |
| 10 | Geoprocessing | GeoprocessingPanel | Run → new layer appears in sidebar |

**Also verify:**
- [ ] Annotation pins in MapEditor auto-update when annotations are created/deleted (no manual refresh)
- [ ] Multiple components subscribing to `['annotations', 'list']` trigger one fetch, not N (check network tab)
- [ ] Hot overlay features render with same styling as cold tile layer
- [ ] Existing tests pass (interaction-modes, annotation-objects, etc.)
- [ ] No TypeScript errors in build
