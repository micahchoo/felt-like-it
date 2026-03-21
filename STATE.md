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

## Shadow Walk — UX Flow Audit (2026-03-21)

10 flows walked, 46 findings. Full audit after reskin revealed broken gestalt — components styled independently without tracing user flows.

### Critical (10)

| # | Flag | File | Flow | Issue |
|---|------|------|------|-------|
| 1 | NO FEEDBACK | DashboardScreen.svelte:24 | Dashboard→Editor | Edit/View buttons are console.log stubs — do nothing |
| 2 | SILENT FAIL | dashboard/+page.svelte:52 | Dashboard→Create | Map creation error uncaught — no toast, no navigation |
| 3 | RACE | DrawingToolbar.svelte:143 | Draw feature | Can draw without active layer — error only after draw completes |
| 4 | SILENT FAIL | AnnotationPanel.svelte:387 | Annotate→Image | Image upload failure shows generic error, not file-specific |
| 5 | SILENT FAIL | ImportDialog.svelte:94 | Import→Poll | Network hiccup kills polling — upload completes silently on server |
| 6 | HIDDEN REQ | ImportDialog.svelte:86 | Import→Timeout | 5min timeout, no cancel/retry button |
| 7 | SILENT FAIL | ExportDialog.svelte:28 | Export→Download | Blob URL revoked on 1s timer — large downloads break |
| 8 | RACE | ShareDialog.svelte:142 | Share→Invite | Invite + refresh race — stale collaborator list |
| 9 | RACE | GeoprocessingPanel.svelte:53 | Geoprocessing | Two-layer ops allow same layer for A and B |
| 10 | RACE | settings/+page.svelte:93 | Settings→API key | Clipboard failure shows "Copied!" anyway |

### High (24)

| # | Flag | File | Flow | Issue |
|---|------|------|------|-------|
| 11 | NO FEEDBACK | LayerPanel.svelte:18 | Add layer | Failed creation stays in UI — no rollback |
| 12 | NO FEEDBACK | MapEditor.svelte:782 | Style | Panel closes without unsaved-changes warning |
| 13 | SILENT FAIL | StylePanel.svelte:118 | Style→Save | Failed save leaves optimistic state — refresh shows old |
| 14 | RACE | AnnotationPanel.svelte:351 | Annotate→Image | EXIF GPS async — submit before parse loses coords |
| 15 | HIDDEN REQ | AnnotationPanel.svelte:281 | Annotate→Submit | Disabled submit, no explanation why |
| 16 | NO FEEDBACK | ImportDialog.svelte:73 | Import→Progress | No progress bar during upload |
| 17 | DEAD END | ImportDialog.svelte:142 | Import→Open | "Import Pipeline" jargon, no help text |
| 18 | NO FEEDBACK | DataTable.svelte:95 | Table→Click | Row click zooms map, no row highlight |
| 19 | HIDDEN REQ | FilterPanel.svelte:13 | Filter→Schema | Fields from first 100 features only |
| 20 | NO FEEDBACK | FilterPanel.svelte:56 | Filter→Apply | No count badge or indicator after apply |
| 21 | HIDDEN REQ | ExportDialog.svelte:157 | Export→Format | PNG=screenshot, GeoJSON=data — inconsistent scope, no label |
| 22 | DEAD END | ExportDialog.svelte:135 | Export→PNG | "Export" delivers screenshot not layer data |
| 23 | HIDDEN REQ | GeoprocessingPanel.svelte:334 | Geoprocess→Run | Disabled button with no explanation |
| 24 | SILENT FAIL | GeoprocessingPanel.svelte:152 | Geoprocess→Error | Generic "failed" on all errors |
| 25 | NO FEEDBACK | ShareDialog.svelte:68 | Share→Open | Empty list flashes before spinner |
| 26 | SILENT FAIL | ShareDialog.svelte:129 | Share→Reopen | Stale error persists on dialog reopen |
| 27 | DEAD END | ShareDialog.svelte:243 | Share→Roles | Role names with no permission explanation |
| 28 | HIDDEN REQ | DrawingToolbar.svelte:296 | Measure→Draw | All tools shown — point useless in measure mode |
| 29 | NO FEEDBACK | MeasurementPanel.svelte:150 | Measure→Save | Save changes sidebar silently — no toast |
| 30 | DEAD END | auth/login:54 | Login→Disabled | Disabled account, no support link |
| 31 | NO FEEDBACK | settings/+page.svelte:50 | Settings→Save | No loading state — double-click fires twice |
| 32 | ASSUMPTION | settings/+page.svelte:62 | Settings→API key | Key shown once, dismissible without copy confirm |
| 33 | NO FEEDBACK | AdminScreen.svelte:160 | Admin→Tabs | No loading state on tab switch |
| 34 | RACE | admin/+page.server.ts:36 | Admin→Audit | 200 entries, no pagination — UI lags |

### Minor (12)

Sidebar label jargon, annotation comments confusion, pre-filled coords unlabeled, measurement clear no confirmation, filter double-click duplicate, export PDF race with tiles, password hint, email disabled unlabeled, unit toggle no animation, "Processing" jargon, measurement content type hidden.

### Hotspots (3+ findings per component)

| Component | Count | Severity Mix |
|-----------|-------|-------------|
| ImportDialog | 5 | 2 critical, 2 high, 1 minor |
| AnnotationPanel | 6 | 1 critical, 2 high, 3 minor |
| ExportDialog | 4 | 1 critical, 2 high, 1 minor |
| ShareDialog | 5 | 1 critical, 3 high, 1 minor |
| GeoprocessingPanel | 4 | 1 critical, 2 high, 1 minor |
| Settings | 5 | 1 critical, 2 high, 2 minor |

### Remediation Routing

| Pattern | Findings | Route | Priority |
|---------|----------|-------|----------|
| SILENT FAIL + RACE (import, export, style, share, draw) | #2-5,7-9,13,14,26 | characterization-testing → fix | **P0** |
| NO FEEDBACK (dashboard, layers, progress, filter, save) | #1,11,12,16,18,20,25,29,31,33 | writing-plans → implement | **P1** |
| DEAD END + HIDDEN REQ (import, export, geoprocess, measure) | #6,15,17,21-23,27,28,30 | writing-plans → implement | **P1** |
| ASSUMPTION (labels, jargon, API key) | #32,35-46 | UI copy pass | **P2** |

---

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
