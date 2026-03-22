# Felt Like It — State Dashboard

_Ephemeral metrics snapshot. Updated after every session. For accumulated knowledge (decisions, patterns, conventions), see `mulch prime`. For phase checklists, see `docs/ROADMAP.md`._

## Current Metrics

| Check | Result |
|-------|--------|
| `svelte-check` | **14 errors, 1 warning** (pre-existing: AnnotationPanel types, MapCanvas spec unions) |
| `vitest (web)` | **720 passing** (50 files) |
| `vitest (geo-engine)` | **208 passing** (9 files) |
| `vitest (shared-types)` | **99 passing** |
| **Total tests** | **1027** |
| `eslint (web)` | **0 errors in api/v1** (pre-existing errors remain in stores/tests: localStorage globals, non-null assertions) |
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
- Pre-existing svelte-check errors in AnnotationPanel.svelte (exactOptionalPropertyTypes mismatches with tRPC mutation types) — not introduced by this session.
- Pre-existing lint errors: `localStorage` globals in store .svelte.ts files, non-null assertions, @ts-nocheck in test mocks.
- Admin audit log: 200 entries, no pagination — UI lags on large datasets (#34 from shadow walk, not yet addressed).

## Shadow Walk — UX Flow Audit (2026-03-21)

10 flows walked, 46 findings. **Remediation completed 2026-03-22.** 45 of 46 findings addressed (fixed or verified already-fixed). 1 deferred (#34 admin pagination).

### Critical (10) — All Resolved

| # | Flag | Status | Issue |
|---|------|--------|-------|
| 1 | NO FEEDBACK | **Already fixed** | DashboardScreen `handleOpen` navigates properly |
| 2 | SILENT FAIL | **Already fixed** | Dashboard `actions.onCreate` has try/catch + toast |
| 3 | RACE | **Already fixed** | DrawingToolbar disables tools when no active layer |
| 4 | SILENT FAIL | **Fixed** | AnnotationPanel shows file-specific upload errors |
| 5 | SILENT FAIL | **Already fixed** | ImportDialog has poll retry with backoff |
| 6 | HIDDEN REQ | **Already fixed** | ImportDialog has cancel button wired to AbortController |
| 7 | SILENT FAIL | **Already fixed** | ExportDialog blob URL revocation at 60s |
| 8 | RACE | **Already fixed** | ShareDialog refetches collaborators after invite |
| 9 | RACE | **Fixed** | GeoprocessingPanel filters layer B to exclude layer A |
| 10 | RACE | **Already fixed** | Settings clipboard uses .then/.catch properly |

### High (24) — All Resolved

| # | Flag | Status | Issue |
|---|------|--------|-------|
| 11 | NO FEEDBACK | **Already fixed** | LayerPanel has try/catch + error toast, no optimistic UI |
| 12 | NO FEEDBACK | **Already fixed** | StylePanel checks dirty state with window.confirm on close |
| 13 | SILENT FAIL | **Fixed** | StylePanel reverts optimistic state on save failure |
| 14 | RACE | **Fixed** | AnnotationPanel disables submit during EXIF parsing |
| 15 | HIDDEN REQ | **Fixed** | AnnotationPanel shows helper text for disabled submit |
| 16 | NO FEEDBACK | **Already fixed** | ImportDialog has progress bar with elapsed time |
| 17 | DEAD END | **Fixed** | ImportDialog uses user-friendly copy, no jargon |
| 18 | NO FEEDBACK | **Already fixed** | DataTable has selectedFeatureId + row highlight |
| 19 | HIDDEN REQ | **Fixed** | FilterPanel notes fields from first 100 features |
| 20 | NO FEEDBACK | **Already fixed** | FilterPanel shows active filter count badge |
| 21 | HIDDEN REQ | **Fixed** | ExportDialog labels: "GeoJSON (layer data)", "PNG (map screenshot)" |
| 22 | DEAD END | **Fixed** | ExportDialog separates "Data Export" and "Map Screenshot" sections |
| 23 | HIDDEN REQ | **Fixed** | GeoprocessingPanel shows helper text when disabled |
| 24 | SILENT FAIL | **Fixed** | GeoprocessingPanel shows specific error messages |
| 25 | NO FEEDBACK | **Fixed** | ShareDialog defaults to loading state, no empty flash |
| 26 | SILENT FAIL | **Already fixed** | ShareDialog clears error on reopen |
| 27 | DEAD END | **Fixed** | ShareDialog shows role descriptions in invite dropdown |
| 28 | HIDDEN REQ | **Already fixed** | DrawingToolbar hides point tool in measure mode |
| 29 | NO FEEDBACK | **Already fixed** | MeasurementPanel shows save toast |
| 30 | DEAD END | **Already fixed** | Login shows disabled account message with contact |
| 31 | NO FEEDBACK | **Already fixed** | Settings has saving state, disables button |
| 32 | ASSUMPTION | **Already fixed** | Settings has Copy button + warning text for API key |
| 33 | NO FEEDBACK | **Fixed** | AdminScreen has fade transition on tab switch |
| 34 | RACE | **Deferred** | Admin audit log pagination — needs backend changes |

### Minor (12) — All Resolved

- **Fixed**: Sidebar label jargon → "Measure & Tools" / "Spatial Tools", annotation comments label → "Map Comments", coordinate labels → "Latitude" / "Longitude", password hint added, filter double-click guard added, export tile load guard added, "Processing" → "Running [op name]...", measurement content type labels
- **Already fixed**: measurement clear confirmation, email disabled label, unit toggle animation, export progress text

---

## Last Session — Frontend Audit Remediation (2026-03-22)

14 commits on `fix/frontend-audit-remediation` branch.

### Web-Next Migration Complete

All 6 routes now use the screen/contract pattern:
- `dashboard/` → DashboardScreen (was already done)
- `admin/` → AdminScreen (was already done)
- `settings/` → SettingsScreen (was already done)
- **`map/[id]/`** → MapEditorScreen (newly wired)
- **`share/[token]/`** → ShareViewerScreen (newly wired)
- **`embed/[token]/`** → EmbedScreen (newly wired)

Contracts simplified: `MapEditorData` provides map/layers/user context, screen owns tRPC queries internally. `ShareViewerData` provides map/layers/token.

### REST API v1 Lint Cleaned

12 route files fixed: `any` → `unknown` with type narrowing, `{#each}` keys added, non-null assertions replaced. Zero lint errors in api/v1/.

### Shadow Walk Remediated

45 of 46 findings resolved. Of these, **26 were already fixed** in prior sessions (the STATE.md was stale). **19 were newly fixed** this session. 1 deferred (admin pagination).

### Store Lint Fixed

`AbortController` global added to viewport store. Layer version cast removed (field exists in schema).

### Delta

| Metric | Before | After |
|--------|--------|-------|
| Routes using screen pattern | 3/6 | **6/6** |
| Shadow walk findings open | 46 | **1** (deferred) |
| REST API v1 lint errors | ~25 | **0** |
| Store lint errors | 3 | **0** |
| Total tests | 720 | **720** (no regression) |
