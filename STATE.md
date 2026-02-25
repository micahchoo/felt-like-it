# Felt Like It — State Dashboard

_Ephemeral metrics snapshot. Updated after every session. For accumulated knowledge (decisions, patterns, conventions), see `mulch prime`. For phase checklists, see `docs/ROADMAP.md`._

## Current Metrics

| Check | Result |
|-------|--------|
| `svelte-check` | **0 errors, 0 warnings** |
| `vitest (web)` | **327 passing** (27 files) |
| `vitest (geo-engine)` | **208 passing** (9 files) |
| `vitest (shared-types)` | **99 passing** |
| **Total tests** | **634** |
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
- 14 structural `as unknown as` casts in MapCanvas.svelte (TYPE_DEBT documented — MapLibre spec union mismatches).
- 2 structural casts in DeckGLOverlay.svelte (TYPE_DEBT documented — deck.gl IControl divergence).
- 1 structural cast in DrawingToolbar.svelte (TYPE_DEBT — terra-draw geometry typing).
- 1 centralized cast in `typedExecute<T>()` (TYPE_DEBT — Drizzle raw SQL rows untyped).
- 5 fetch mock casts in geocode.test.ts (geo-engine package — acceptable test mocks).

## Last Session — Tech Debt & Audit Wiring Fix

5 commits on `fix/tech-debt-audit-wiring` branch.

### Fix 1: Dashboard audit bypass (HIGH)
- Extracted shared map operations to `lib/server/maps/operations.ts` — `createMap`, `deleteMap`, `cloneMap`, `createFromTemplate`
- Both tRPC routers and dashboard form actions now call the same functions with audit logging
- Fixed audit-before-delete ordering (audit fires after successful delete, not before)
- Net: ~75 lines removed from dashboard, ~170 lines removed from maps router, ~200 lines in new shared module

### Fix 2: Upload endpoint access control (HIGH)
- Upload endpoint now allows editor collaborators, not just map owners
- Uses same owner-fast-path + collaborator check pattern as `requireMapAccess`

### Fix 3: Drop `maps.isArchived` (MEDIUM)
- Migration `0010_drop_is_archived.sql`
- Removed from schema, all queries, shared-types MapSchema, and 5 test mock files

### Test 4: Shapefile import tests
- New `import-shapefile.test.ts` (9 tests): .zip, raw .shp, multi-FC array, null geometry filter, empty, unsupported extension

### Test 5: geo-engine transform.ts tests
- New `transform.test.ts` (24 tests): normalizeCoordinates, looksLikeWGS84, toRadians, toDegrees, computeBbox

### Delta

| Metric | Before | After |
|--------|--------|-------|
| Total tests | 601 | **634** (+33) |
| Web test files | 26 | **27** (+1) |
| Geo-engine test files | 8 | **9** (+1) |
| Dashboard audit coverage | None | **Full** (create/delete/clone/template) |
| Upload access model | Owner-only | **Owner + editor collaborators** |
| `maps.isArchived` | Dead column + filters | **Removed** |
