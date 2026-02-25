# Felt Like It — State Dashboard

_Ephemeral metrics snapshot. Updated after every session. For accumulated knowledge (decisions, patterns, conventions), see `mulch prime`. For phase checklists, see `docs/ROADMAP.md`._

## Current Metrics

| Check | Result |
|-------|--------|
| `svelte-check` | **0 errors, 0 warnings** |
| `vitest (web)` | **318 passing** (26 files) |
| `vitest (geo-engine)` | **184 passing** |
| `vitest (shared-types)` | **99 passing** |
| **Total tests** | **601** |
| `eslint (web)` | **0 errors, 0 warnings** |
| `eslint (root)` | **39 errors** (pre-existing: e2e `parserOptions.project` mismatch + dirty working tree) |
| `pnpm build` | **pass** (web + worker) |

## Known Debt

- `TODO(loop):` multi-table GeoPackage import (escalated — structural worker change, not blocking)
- Measurement tool: live/interactive measurement not implemented — only final shape is measured.
- `GeoAggregateBaseSchema` used in discriminated union (not refined); cross-field invariant at router level only.
- `/embed/[token]` frame header: self-hosters with nginx `X-Frame-Options SAMEORIGIN` must remove that header for embed.
- Audit log `verify` is O(n) — suitable for scheduled checks, not real-time.
- Audit log does not catch feature/layer mutations (high-volume, lower security concern).
- Remaining TYPE_DEBT: `import-geopackage.test.ts:22` — vi.fn() mock cast (acceptable).
- 22 structural `as unknown as` casts in MapCanvas.svelte (TYPE_DEBT documented — MapLibre spec union mismatches).
- 2 structural casts in DeckGLOverlay.svelte (TYPE_DEBT documented — deck.gl IControl divergence).

## Last Session — Tech Debt Concentration

10 commits across 41 files (+840, -748 lines). Chunked by roadmap phase:

### Chunk 1: Test Infrastructure (cross-cutting)
- Created shared `test-utils.ts` with `drizzleChain`, `mockContext`, `publicContext`, `DbExecuteResult`
- Migrated all 13 router test files — **~85 `as unknown as` casts eliminated**, ~330 LOC of boilerplate removed

### Chunk 2: Import Pipeline DRY-up (Phase 1–2 era)
- Extracted `createLayerAndInsertFeatures()` into `import/shared.ts` with 4 tests
- Refactored 5 import modules (geojson, csv, shapefile, xmlgeo, geopackage) — **~160 LOC duplication removed**
- GeoPackage WKB path left untouched (different insert function)

### Chunk 3: Server-Side Type Safety (Phase 2–4)
- Added `typedExecute<T>()` wrapper in `geo/queries.ts` — centralizes the single `db.execute()` cast
- Replaced 4 raw-SQL row casts in `queries.ts` + `annotations.ts`
- Narrowed terra-draw feature typing in `DrawingToolbar.svelte` — imported `GeoJSONStoreFeatures`, widened callback signatures

### Chunk 4: Client-Side Serialization (Phase 3–5)
- Added `superjson` transformer to tRPC (server + client) — `Date` objects now round-trip correctly
- Removed 6 Date-serialization casts in MapEditor, LayerPanel, AnnotationPanel
- Updated 6 component interfaces (`ActivityFeed`, `CollaboratorsPanel`, `CommentPanel`, `GuestCommentPanel`, `ShareDialog`, `AnnotationContent`) from `string` dates to `Date`
- Narrowed `layers.list`/`layers.create` return types to `Layer['type']` union

### Chunk 5: Structural Cast Documentation
- Added TYPE_DEBT comments to 17 structural casts in MapCanvas.svelte + DeckGLOverlay.svelte

### Chunk 6: Worker Type Guards (Phase 1 era)
- Replaced 3 `as unknown as` casts in worker with `isFeatureCollection`/`isFeature`/`isGeometry` type guards
- Added `toRecord()` helper for geometry conversion without casts

### Summary

| Metric | Before | After |
|--------|--------|-------|
| `as unknown as` casts (production) | ~35 | 30 (24 documented TYPE_DEBT) |
| `as unknown as` casts (tests) | ~95 | 31 (28 in import tests, 3 centralized in test-utils) |
| Import module duplication | ~200 LOC × 5 | 1 shared function + 5 thin wrappers |
| Test boilerplate per file | ~25 LOC | 1 import line |
| tRPC Date serialization | Strings (silent type mismatch) | Proper Date objects (superjson) |
