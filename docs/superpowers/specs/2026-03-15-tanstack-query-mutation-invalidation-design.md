# TanStack Query Mutation Invalidation — Design Spec

**Date:** 2026-03-15
**Status:** Approved (rev 3 — incorporates spec review + two industry reference docs)
**Scope:** Targeted — fix 11 broken mutation flows with @tanstack/svelte-query
**References:**
- `docs/reference/How mapping teams manage annotation mutation state.md`
- `docs/reference/Twelve architectural patterns for mutable map and canvas annotation state.md`

## Problem

The app uses tRPC v11 with direct `createTRPCClient` calls (no query cache layer). After mutations, UI updates depend on manual refetch callbacks between parent/child components. Multiple flows are broken:

- Drawn features on large layers invisible until page refresh
- Annotation thread replies stale until collapse/expand
- Comment delete optimistic with no rollback
- Undo/redo doesn't refresh the map
- Duplicate queries fired on annotation create
- Geoprocessing results don't appear in sidebar

**Root cause:** No query cache invalidation layer. Every mutation must manually trigger all dependent data reloads via parent callbacks — and many don't.

## Industry Context

This design aligns with patterns documented in the reference doc:

- **Fine-grained last-write-wins** (Felt, Figma, Excalidraw pattern) — our annotation service already uses optimistic concurrency with version numbers. TanStack Query's cache invalidation complements this by ensuring the UI reflects the latest server state after each write.
- **Hot/cold source pattern** (Mapbox GL Draw) — separates actively edited features from stable rendered features. We adopt this for large layers: recently-drawn features render in a reactive GeoJSON "hot" overlay while Martin tiles serve the stable "cold" base.
- **Declarative vs imperative tension** — the reference doc identifies this as "the central architectural challenge." Our vector tile reload must work WITH `svelte-maplibre-gl`'s declarative source management, not against it (see revised Flow 8).
- **Felt's merge-on-demand** — pre-generated tiles + edit delta + dynamic merge. Our hot/cold overlay is a lightweight version of this pattern.

From the "Twelve architectural patterns" reference:

- **Reactive derived state with signals** (Pattern 8) — tldraw's signal-based architecture uses a three-layer pattern: signal atoms for root state, computed derivations for intermediate values, reactive side effects for external updates. Our design mirrors this: TanStack Query cache as the atom layer, `$derived` runes for annotation pins/GeoJSON as computed derivations, and Svelte 5 effects for MapLibre source updates as side effects. Key insight: "computed values should only recompute when their specific dependencies change, never on every frame."
- **Batching** (Pattern 9) — TanStack Query naturally deduplicates concurrent requests to the same query key. Multiple components subscribing to `['annotations', 'list']` trigger one fetch, not N. This directly fixes the duplicate query problem from the shadow walk (AnnotationPanel + MapEditor both refetching annotation lists). Excalidraw's recommended 500ms debounce on save is analogous to TanStack's `staleTime` config.
- **Presence vs document state** (Pattern 3) — Our TanStack Query cache is ephemeral (resets on page load), serving as a bridge between server document state (DB) and the UI. This aligns with the industry pattern: selection state and interaction state (our discriminated union) are correctly modeled as presence (ephemeral, per-user), while annotation/feature data flows through the persistent query→cache→derive pipeline.
- **Hot/cold source + selection** (Pattern 4) — Mapbox GL Draw moves features between hot/cold sources based on selection state, not just recency. Our hot overlay should also render the currently-selected feature on large layers (where `queryRenderedFeatures` may return stale tile data for a just-edited feature).

## Decisions

1. **Targeted scope** — only wrap the 11 broken mutation flows, not all tRPC calls
2. **Hot/cold overlay for large layers** — recently-mutated features render in a reactive GeoJSON overlay source; Martin tiles serve the stable base. No imperative `setTiles()` calls that conflict with `svelte-maplibre-gl`.
3. **Optimistic for deletes/resolves, refetch for creates** — deletes/resolves feel instant with rollback on error; creates refetch since we need server-generated data

## Infrastructure

### New Dependencies

- `@tanstack/svelte-query` — query/mutation management for Svelte 5

### New Files

- `apps/web/src/lib/utils/query-client.ts` — singleton QueryClient with defaults
- `apps/web/src/lib/utils/query-keys.ts` — typed query key factory
- `apps/web/src/lib/utils/map-sources.ts` — hot overlay helpers for large layer feature mutations

### Query Key Convention

```
['annotations', 'list', { mapId }]
['annotations', 'getThread', { annotationId }]
['comments', 'list', { mapId }]
['features', 'list', { layerId }]
['layers', 'list', { mapId }]
```

Invalidating `['annotations']` clears all annotation queries. Narrower keys clear specific queries.

### Provider Setup

QueryClientProvider added in root `+layout.svelte` or MapEditor (since queries are only used in map editor context).

### What Stays the Same

- Existing `trpc` client — queries/mutations still call it under the hood
- Server-side `+page.server.ts` data loading
- All Svelte stores (layers, selection, undo, etc.)
- Components that only read data without mutation dependencies

## Mutation Flows

### Flow 1: Annotation Create — `AnnotationPanel.svelte`

- Replace manual `trpc.annotations.create.mutate()` + `loadAnnotations()` with `createMutation`
- `onSuccess`: invalidate `['annotations', 'list']`
- Eliminates duplicate query problem (both `loadAnnotations` and `loadAnnotationPins` currently refetch separately)
- MapEditor subscribes to the same `['annotations', 'list']` query; annotation pins derived reactively via `$derived`
- Remove `onannotationchange` data-refresh responsibility

### Flow 2: Annotation Delete — `AnnotationPanel.svelte`

- `createMutation` with `onMutate`: optimistic remove from `['annotations', 'list']` cache, save previous data
- `onError`: restore previous cache data
- `onSettled`: invalidate `['annotations', 'list']` to reconcile with server truth

### Flow 3: Annotation Reply — `AnnotationPanel.svelte`

- `createMutation` for reply creation
- `onSuccess`: invalidate `['annotations', 'list']` AND `['annotations', 'getThread', { annotationId: parentId }]`
- Thread expansion changes from inline `{#await trpc.annotations.getThread.query(...)}` to a `createQuery` so it participates in cache
- Note: reply annotations with `parentId` must appear in the list query results for pin derivation to work correctly

### Flow 3a: Annotation Update (IIIF NavPlace) — `AnnotationPanel.svelte`

- `trpc.annotations.update.mutate()` (currently at ~line 437) becomes `createMutation`
- `onSuccess`: invalidate `['annotations', 'list']` — annotation content/anchor may have changed
- Covers the IIIF navPlace update path that was previously missing from the spec

### Flow 4: Comment Create — `AnnotationPanel.svelte`

- `createMutation` with `onSuccess`: invalidate `['comments', 'list']`, update count
- `onError`: show error toast (no rollback needed since nothing was optimistically modified)
- Fixes race condition where "Failed to post comment" shows when comment actually exists

### Flow 5: Comment Delete — `AnnotationPanel.svelte`

- `createMutation` with `onMutate`: optimistic remove from `['comments', 'list']` cache + update count, save previous state
- `onError`: restore previous cache, restore count, show error toast
- `onSettled`: invalidate to reconcile

### Flow 6: Comment Resolve — `AnnotationPanel.svelte`

- `createMutation` with `onMutate`: optimistic toggle `resolvedAt` in cache, save previous state
- `onError`: restore previous cache
- `onSettled`: invalidate `['comments', 'list']`
- Eliminates unchecked type cast — refetch on settle returns properly typed server data

### Flow 7: Feature Draw (Small Layer) — `DrawingToolbar.svelte` + `MapEditor.svelte`

- `trpc.features.upsert.mutate()` becomes `createMutation`
- `onSuccess`: invalidate `['features', 'list', { layerId }]`
- MapEditor's `loadLayerData` becomes a `createQuery` wrapping `trpc.features.list.query({ layerId })`
- GeoJSON source updates reactively when query refetches

### Flow 8: Feature Draw (Large Layer) — `MapEditor.svelte`

- Same mutation as #7
- **Hot/cold overlay pattern** (inspired by Mapbox GL Draw's hot/cold sources):
  - Martin vector tiles serve the stable "cold" base — no imperative `setTiles()` calls (avoids conflict with `svelte-maplibre-gl`'s declarative source management)
  - A reactive GeoJSON "hot" overlay source renders recently-drawn features on top
  - `onSuccess`: add the drawn feature's GeoJSON to a `$state` hot features array, keyed by `layerId`
  - The hot overlay renders with the same styling as the layer's cold tiles
  - Hot features are cleared when the user navigates away or on next page load (Martin will have incorporated them by then)
- Replaces the current `isLargeLayer` branch that silently skips reload
- Future enhancement: periodic reconciliation (clear hot overlay once Martin tiles include the new features) — out of scope for this PR

### Flow 9: Feature Undo/Redo — `DrawingToolbar.svelte`

- Undo (`trpc.features.delete.mutate()`) and redo (`trpc.features.upsert.mutate()`) become `createMutation` calls
- Both: `onSuccess` invalidates `['features', 'list', { layerId }]` + updates hot overlay if large layer (add for redo, remove for undo)
- Fixes current bug where undo deletes from DB but map doesn't update

### Flow 10: Geoprocessing — `GeoprocessingPanel.svelte`

- `trpc.geoprocessing.run.mutate()` becomes `createMutation`
- `onSuccess`: invalidate `['layers', 'list', { mapId }]`
- Parent `onlayercreated` callback stays (for setting new layer active), but layer list refresh is automatic
- New layer appears in sidebar without manual reload

## Annotation Pin Reactivity

**Current (broken):** `AnnotationPanel.onannotationchange()` → `MapEditor.loadAnnotationPins()` → rebuild GeoJSON → pass to MapCanvas. Causes duplicate queries and missed updates.

**New:** MapEditor creates a `createQuery` for `['annotations', 'list', { mapId }]`. Annotation pins GeoJSON is `$derived` from that query's data. Any annotation mutation invalidates the query, pins rebuild automatically. The `onannotationchange` callback is kept ONLY for interaction state transitions (clear `drawRegion`/`pickFeature` after save), renamed to `onannotationsaved`.

## Hot Overlay for Large Layers

Adopts the **hot/cold source pattern** from Mapbox GL Draw (documented in reference doc, section "Mode-based state machines"):

- Location: `apps/web/src/lib/utils/map-sources.ts`
- `hotFeatures`: a `$state` record keyed by `layerId`, each value is a GeoJSON FeatureCollection of recently-mutated features
- `addHotFeature(layerId, feature)`: adds to the overlay after successful upsert
- `removeHotFeature(layerId, featureId)`: removes from overlay after successful delete/undo
- `setSelectedHotFeature(layerId, feature)`: renders the currently-selected feature in the hot overlay (ensures just-edited features on large layers are visible even if Martin tiles haven't updated yet — mirrors Mapbox GL Draw's pattern of moving features between hot/cold sources based on selection state)
- `clearHotFeatures(layerId?)`: clears overlay on navigation or layer switch
- MapCanvas renders hot overlay as an additional GeoJSON source/layer per active large layer, styled to match the cold tile layer
- `createQuery` calls at component init (top-level `<script>`) — never inside `$effect` or conditionally — to maintain TanStack Query's reactive contract with Svelte 5

**Why not imperative `setTiles()`?** `svelte-maplibre-gl` manages vector tile sources declaratively. Calling `source.setTiles()` imperatively creates a race where the next reactive update reverts the cache-bust param. The hot overlay avoids this entirely.

## Testing

### New Tests

- Query key factory produces correct keys
- Hot overlay: `addHotFeature` / `removeHotFeature` / `clearHotFeatures` produce correct GeoJSON state
- Optimistic update helpers (delete from cache, toggle resolve) produce correct cache state
- Rollback restores previous cache on error
- After `annotations.create` mutation succeeds, `['annotations', 'list']` is invalidated
- After `annotations.update` mutation succeeds, `['annotations', 'list']` is invalidated
- After `features.upsert` on large layer, hot overlay contains the new feature
- After `comments.delete` fails, optimistic removal is rolled back

### Existing Tests (Untouched)

- `interaction-modes.test.ts` (33 tests) — state machine logic doesn't change
- `annotation-objects.test.ts` (14 tests) — server-side service layer doesn't change
- `annotation-changelog.test.ts` (3 tests) — server-side changelog doesn't change

## Files Modified

| File | Change |
|------|--------|
| `apps/web/package.json` | Add `@tanstack/svelte-query` |
| `apps/web/src/lib/utils/query-client.ts` | **New** — QueryClient singleton |
| `apps/web/src/lib/utils/query-keys.ts` | **New** — typed query key factory |
| `apps/web/src/lib/utils/map-sources.ts` | **New** — hot overlay state + helpers for large layer mutations |
| `apps/web/src/routes/(app)/+layout.svelte` or `MapEditor.svelte` | QueryClientProvider |
| `apps/web/src/lib/components/annotations/AnnotationPanel.svelte` | Flows 1-6: replace manual mutations with createMutation |
| `apps/web/src/lib/components/map/MapEditor.svelte` | Annotation pins as derived query, feature query, remove data-refresh callbacks |
| `apps/web/src/lib/components/map/DrawingToolbar.svelte` | Flows 7-9: wrap upsert/delete/undo/redo in createMutation |
| `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte` | Flow 10: wrap geoprocessing mutation |
| `apps/web/src/__tests__/query-invalidation.test.ts` | **New** — mutation → invalidation tests |

## Intentionally Excluded Flows

The following mutations exist in the codebase but are **out of scope** for this PR. They use local Svelte store updates (`layersStore`) or don't have the stale-data symptoms this spec addresses:

| Component | Mutations | Reason excluded |
|-----------|-----------|-----------------|
| `LayerPanel.svelte` | `layers.create`, `layers.update`, `layers.delete`, `layers.reorder` | Use optimistic `layersStore` updates; would benefit from query migration but are not currently broken |
| `ShareDialog.svelte` | `shares.create`, `shares.delete`, `collaborators.invite/remove/updateRole` | Local dialog state, no map rendering dependency |
| `GuestCommentPanel.svelte` | `comments.createForShare` | Share view only, no interaction with map editor queries |
| `MapEditor.svelte` | `maps.update` (viewport save) | Fire-and-forget, no UI depends on the result |
| `AdminPanel` | `admin.*` mutations | Separate page, no map editor interaction |

These can be migrated incrementally in follow-up PRs once the pattern is established.

## Implementation Constraints

- **`createQuery` must be called at component top-level** (`<script>` block), never inside `$effect` or conditionally. `@tanstack/svelte-query` v5+ returns Svelte 5 `$state`-based stores that require stable initialization. This is a Svelte 5 + TanStack footgun.
- **Annotation reply pins**: Reply annotations (with `parentId`) must appear in the `['annotations', 'list']` query results for the `$derived` pin derivation to work. Verify the tRPC `annotations.list` endpoint includes replies or adjust the derivation to fetch threads separately.

## Risk

**Medium.** Touching 4 core components (AnnotationPanel, MapEditor, DrawingToolbar, GeoprocessingPanel) and adding a new dependency. Mitigated by:
- No server-side changes — all changes are client-side query/mutation wrappers
- Existing tRPC client unchanged — new code wraps it, doesn't replace it
- State machine tests unchanged — interaction state logic not affected
- Incremental — each flow can be migrated and tested independently
- Query deduplication — TanStack Query naturally batches identical queries (multiple components subscribing to `['annotations', 'list']` trigger one fetch, fixing the duplicate query problem)

## QueryClient Configuration

```typescript
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,      // 30s — data considered fresh, no refetch on mount
      gcTime: 5 * 60_000,     // 5min — cache retained after unmount
      refetchOnWindowFocus: false,  // avoid surprise refetches mid-editing
      retry: 1,               // one retry for transient network errors
    },
  },
});
```

`staleTime: 30_000` acts as a natural debounce (similar to Excalidraw's recommended 500ms save debounce from the reference doc, but for reads). Data fetched within the last 30s is served from cache without a network request.

## Future Considerations (Out of Scope)

These patterns from the reference docs are relevant but not addressed by this PR:

- **Spatial indexing (rbush)** — if annotation pin density grows beyond hundreds per map, `queryRenderedFeatures` may become a bottleneck. rbush would provide O(log n) hit-testing. Currently not needed.
- **Local-first / offline** — Electric SQL or PowerSync could replace the TanStack Query cache with a client-side SQLite database, enabling offline annotation editing. The LWW conflict resolution our annotation service already uses (version numbers) aligns with what these sync engines expect.
- **Undo/redo refactor** — the current undo implementation in DrawingToolbar is a simple stack. The reference docs show tldraw's "marks" pattern (checkpoints that group drag operations) and Figma's per-client undo stacks as more robust approaches. The hot overlay adds a natural place to track undoable feature state.
- **Presence layer** — cursor positions, viewport sharing, and "follow" mode for collaborative editing. Would use a separate ephemeral channel (WebSocket), never mixed into the TanStack Query cache.
