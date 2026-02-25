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
| `eslint (root)` | **0 errors** |
| `pnpm build` | **pass** (web + worker) |

## Known Debt

- `TODO(loop):` multi-table GeoPackage import (escalated — structural worker change, not blocking)
- Measurement tool: live/interactive measurement not implemented — only final shape is measured.
- `GeoAggregateBaseSchema` used in discriminated union (not refined); cross-field invariant at router level only.
- `/embed/[token]` frame header: self-hosters with nginx `X-Frame-Options SAMEORIGIN` must remove that header for embed.
- Audit log `verify` is O(n) — suitable for scheduled checks, not real-time.
- Audit log does not catch feature/layer mutations (high-volume, lower security concern).
- 22 structural `as unknown as` casts in MapCanvas.svelte (TYPE_DEBT documented — MapLibre spec union mismatches).
- 2 structural casts in DeckGLOverlay.svelte (TYPE_DEBT documented — deck.gl IControl divergence).
- 1 structural cast in DrawingToolbar.svelte (TYPE_DEBT — terra-draw geometry typing).
- 1 centralized cast in `typedExecute<T>()` (TYPE_DEBT — Drizzle raw SQL rows untyped).
- 5 fetch mock casts in geocode.test.ts (geo-engine package — acceptable test mocks).

## Last Session — Tech Debt Concentration Round 2

4 commits. Continued from Round 1 (10 commits, +840/-748 lines).

### Chunk 1: Root ESLint Config — 39 → 0 errors
- Rewrote root `eslint.config.js`: excluded `apps/web/**` (has own config) and `scripts/**` (no tsconfig)
- Added `varsIgnorePattern: '^_'` to match web config
- Fixed worker: removed unused `eq` import, added 4 `eslint-disable-next-line no-await-in-loop` for sequential batch loops

### Chunk 2: Import Test Mock Migration
- Migrated 4 import test files (`import-geojson`, `import-csv`, `import-kml-gpx`, `import-geopackage`) to shared `drizzleChain()` — **15 casts eliminated**

### Chunk 3: mockExecuteResult Helper
- Added `mockExecuteResult<T>()` to test-utils.ts
- Migrated `annotations.test.ts` (6 casts) and `maps.test.ts` (1 cast) — **7 casts eliminated**

### Chunk 4: Production Type Guards
- `geojson.ts`: added `isGeoJSONFeature` + `isGeoJSONGeometry` type guards — 2 casts replaced
- `xmlgeo.ts`: added `toProjectGeometry()` — single-hop cast after GeometryCollection exclusion
- `MapEditor.svelte`: added `isFeatureCollection` type guard — 1 cast replaced

### Combined Summary (Round 1 + Round 2)

| Metric | Before (R1 start) | After R1 | After R2 |
|--------|-------------------|----------|----------|
| `as unknown as` casts (production) | ~35 | 30 (24 TYPE_DEBT) | 26 (24 TYPE_DEBT + 2 centralized) |
| `as unknown as` casts (tests) | ~95 | 31 | 12 (4 centralized in test-utils, 5 geocode mock, 2 kml-gpx, 1 layers) |
| `eslint (root)` | 39 errors | 39 errors | **0 errors** |
| Import module duplication | ~200 LOC × 5 | 1 shared function + 5 thin wrappers | — |
| Test boilerplate per file | ~25 LOC | 1 import line | — |
| tRPC Date serialization | Strings (silent type mismatch) | Proper Date objects (superjson) | — |
