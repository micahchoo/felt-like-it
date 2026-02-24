# Felt Like It — Build State

## Phase 5 — Enterprise Polish ✅ COMPLETE

**Tests:** 308 passing (web) · shared-types: 96 · geo-engine: 178 — total: 582
**svelte-check:** 0 errors · 0 warnings
**Lint (web):** 0 errors · 0 warnings

---

## Delta — this round (Phase 5b hardening batch 2: pino, admin, exports, E2E)

### Added
- `apps/web/src/lib/server/logger.ts` — pino structured JSON logging (web)
- `services/worker/src/logger.ts` — pino structured JSON logging (worker)
- `apps/web/src/lib/server/db/migrations/0009_add_admin_flag.sql` — `is_admin` column on `users`
- `apps/web/src/routes/(app)/admin/` — admin panel: user list, storage stats, import job monitor (6 files)
- `scripts/admin-cli.ts` — CLI: create-user, reset-password, promote, demote, list-users
- `apps/web/src/lib/server/export/shared.ts` — shared export access check with viewer+ collab support
- `apps/web/src/lib/server/export/geopackage.ts` — OGC-conformant GeoPackage export (sql.js + wkx)
- `apps/web/src/lib/server/export/shapefile.ts` — Shapefile export (@mapbox/shp-write, DBF truncation)
- `apps/web/src/lib/server/export/pdf.ts` — PDF map export (pdfkit, optional screenshot embed)
- `apps/web/playwright.config.ts` — Playwright E2E config
- `apps/web/e2e/` — 6 E2E spec files + auth fixtures + test data (12 tests)
- `apps/web/src/__tests__/export.test.ts` — 7 export unit tests
- `.github/workflows/ci.yml` — E2E job with PostGIS + Redis services

### Changed
- `apps/web/src/hooks.server.ts` — pino logging; API key auth selects `isAdmin`; removed dead `tag` variable
- `apps/web/src/lib/server/trpc/init.ts` — pino logging
- `apps/web/src/lib/server/audit/index.ts` — pino logging
- `services/worker/src/index.ts` — pino logging (7 call sites)
- `apps/web/src/lib/server/db/schema.ts` — `isAdmin` column on users
- `apps/web/src/lib/server/auth/index.ts` — Lucia `isAdmin` propagation
- `apps/web/src/routes/(app)/+layout.server.ts` — returns `isAdmin` in user data
- `apps/web/src/routes/(app)/dashboard/+page.svelte` — admin link (visible when `isAdmin`)
- `apps/web/src/routes/api/export/[layerId]/+server.ts` — multi-format GET + PDF POST
- `scripts/migrate.ts` — added migrations 0006-0009 to MIGRATION_FILES
- `scripts/seed.ts` — demo user set as admin
- `docker/docker-compose.yml` — `LOG_LEVEL` env var for web + worker

### Removed
- `apps/web/src/lib/server/export/geojson.ts` — orphaned after refactor to shared.ts

### Tests
- Total: 582 (web: 308, geo-engine: 178, shared-types: 96)
- New: 7 export tests, 12 Playwright E2E tests

---

## Delta — previous round (Hardening: Phase 5b batch 1)

### Fixed
- `apps/web/src/lib/server/trpc/routers/maps.ts` — added missing `appendAuditLog` to `maps.update` (12 mutations now audit-logged)
- `apps/web/src/hooks.server.ts` — removed TYPE_DEBT cast; added rate limiting on auth endpoints (10 req/min/IP)
- `apps/web/src/lib/server/auth/index.ts` — removed unnecessary `as { email; name }` cast

### Added
- `apps/web/src/lib/server/rate-limit.ts` — in-memory sliding-window rate limiter
- `apps/web/src/__tests__/rate-limit.test.ts` — 4 tests: under limit, over limit, IP isolation, window expiry
- `.github/workflows/ci.yml` — GitHub Actions: lint, svelte-check, test (all 3 packages), build
- `docs/adr/004-martin-over-pg-tileserv.md` — ADR-004
- `docs/adr/005-bullmq-over-pg-boss.md` — ADR-005
- `docs/adr/006-trpc-fetch-over-websocket.md` — ADR-006
- `apps/web/vite.config.ts` — raised coverage thresholds to 75/85/84/75; scoped coverage to server + stores

### Docs
- `docs/ARCHITECTURE.md` — fixed tRPC table (added 6 missing routers, removed nonexistent `styles`); added 3 missing DB tables; fixed `map_events` column names; updated request flow diagram; added API key auth; updated test file list (23 files); synced test count (575); updated audit mutation count (12); updated Delta from Original Vision (rate limiting, CI, ADRs, coverage now done)
- `docs/ROADMAP.md` — fixed MapLibre GL 4→5; marked Phase 5b hardening items complete; linked ADRs 004-006
- `STATE.md` — updated test count (575); removed stale gaps; updated Phase 5b checklist
- `docs/DOCSTATE.md` — created (doc status tracker with coverage + gaps)

### Tests
- `apps/web/src/__tests__/maps.test.ts` — added test for `maps.update` audit log call
- Total: 575 (web: 301, geo-engine: 178, shared-types: 96)

---

## Delta — previous round (Bug-fix: toolbar overflow hiding annotation suite)

### Fixed
- `apps/web/src/lib/components/map/MapEditor.svelte`
  - **Root cause**: 11 toolbar buttons totalling ~1144px minimum width overflowed the center column (clipped silently by outer `overflow-hidden`). "Annotate" disappeared at ≤~1048px total window width.
  - **Fix**: Converted 9 of 11 buttons to icon-only (kept text labels only on Import/Export which have no icon-only precedent); added `<Tooltip>` to Table and Save View (previously un-labelled icon-only); removed text from Comments/Annotate/Measure/Geoprocess/Collaborators/Activity (all already Tooltip-wrapped). Tightened `gap-2 → gap-1`.
  - New toolbar minimum width: ~556px — fits at any screen ≥ 780px.

---

## Delta — previous round (Bug-squash: collaborator access + coverage gaps)

### Fixed
- `apps/web/src/routes/(app)/map/[id]/+page.server.ts`
  - Editor page now allows collaborators: removed owner-only filter; added inline two-query collab check (owner fast-path → collab record fallback → 404)
- `apps/web/src/lib/server/trpc/routers/comments.ts`
  - `comments.list`: replaced owner-only check with `requireMapAccess(viewer+)`
  - `comments.create`: replaced owner-only check with `requireMapAccess(commenter+)`
- `apps/web/src/lib/server/trpc/routers/layers.ts`
  - `layers.update`: added null guard before spread — throws INTERNAL_SERVER_ERROR if `.returning()` is empty
- `apps/web/src/hooks.server.ts`
  - Removed `TYPE_DEBT` cast on `userRow` — Lucia `DatabaseUserAttributes` makes it structurally identical to `User`

### Added
- `apps/web/src/__tests__/features.test.ts` — 9 tests: `list` (FeatureCollection, NOT_FOUND ×2), `upsert` (insert, update, NOT_FOUND, FORBIDDEN), `delete` (count, NOT_FOUND)
- `apps/web/src/__tests__/shares.test.ts` — 10 tests: `create` (INSERT/UPDATE path, NOT_FOUND), `getForMap` (found, null, NOT_FOUND), `delete` (success, NOT_FOUND), `resolve` (valid token, invalid token)
- `apps/web/src/lib/server/db/migrations/0008_add_check_constraints.sql` — CHECK constraints on `map_collaborators.role`, `shares.access_level`, `layers.type`
- `apps/web/src/__tests__/comments.test.ts` — added `mapCollaborators` mock, `innerJoin` to chain, 2 collaborator tests (viewer list, commenter create)

---

## Delta — previous round (Collaborator role enforcement)

### Added
- `apps/web/src/lib/server/geo/access.ts`
  - `requireMapAccess(userId, mapId, minRole)` — enforces viewer/commenter/editor/owner access on maps
  - Owner fast-path (1 DB query); collaborator path (2 DB queries)
  - NOT_FOUND for absent access (hides map existence); FORBIDDEN for insufficient role
- `apps/web/src/__tests__/map-access.test.ts`
  - 11 tests covering: owner fast-path, NOT_FOUND (map missing), NOT_FOUND (owner-level denied), NOT_FOUND (no collab), FORBIDDEN (viewer→editor), FORBIDDEN (commenter→editor), FORBIDDEN (viewer→commenter), and role-meets/exceeds-minRole paths

### Changed
- `apps/web/src/lib/server/trpc/routers/maps.ts`
  - `maps.get` — opens to viewer+: fetches map without userId filter, then inline collab check for non-owners (existing owner-path tests unchanged: still 2 db.select calls)
  - `maps.listCollaborating` — new procedure: returns maps where caller is an invited collaborator (innerJoin mapCollaborators + maps)
- `apps/web/src/lib/server/trpc/routers/layers.ts`
  - All 5 procedures (`list`, `create`, `update`, `delete`, `reorder`) now use `requireMapAccess` instead of direct ownership SQL; access levels: list=viewer, create/update/delete/reorder=editor
- `apps/web/src/lib/server/trpc/routers/features.ts`
  - `list` → viewer+; `upsert`/`delete` → editor+; via `requireMapAccess`
- `apps/web/src/lib/server/trpc/routers/geoprocessing.ts`
  - `run` → editor+; via `requireMapAccess`
- `apps/web/src/lib/server/trpc/routers/annotations.ts`
  - `list` → viewer+; `create` → commenter+; via `requireMapAccess`
- `apps/web/src/routes/(app)/dashboard/+page.server.ts`
  - `load()` now also queries `sharedMaps` (maps where user is a collaborator, not owner) and returns it in PageData
- `apps/web/src/routes/(app)/dashboard/+page.svelte`
  - Added "Shared with me" section below the user's own maps; shows role badge; no clone/delete actions
- `apps/web/src/__tests__/maps.test.ts`
  - Added `mapCollaborators` to mock; added `innerJoin` to drizzleChain; added `maps.get` collaborator tests (+2); added `maps.listCollaborating` tests (+2) — total 25 tests
- `apps/web/src/__tests__/layers.test.ts`
  - Added `mapCollaborators` to mock; updated FORBIDDEN tests (viewer < editor → 3-select mock sequence)
- `apps/web/src/__tests__/geoprocessing.test.ts`
  - Added `mapCollaborators` to mock; added `userId: USER_ID` to `MOCK_MAP` so owner fast-path works
- `apps/web/src/__tests__/annotations.test.ts`
  - Added `mapCollaborators` to mock

---

## Gaps — known blockers / debt

- **None blocking merge.**
- `TODO(loop):` multi-table GeoPackage import (escalated — structural worker change, not blocking)
- Measurement tool: live/interactive measurement not implemented — only final shape is measured.
- `GeoAggregateBaseSchema` used in discriminated union (not refined); cross-field invariant at router level only.
- `/embed/[token]` frame header: self-hosters using nginx with `add_header X-Frame-Options SAMEORIGIN` at proxy level must remove that header for embed to work.
- Audit log `verify` is O(n) over the full log — suitable for scheduled checks, not real-time.
- Audit log does not catch feature/layer mutations (high-volume, lower security concern — can extend later).
- Collaborator roles NOT enforced in dashboard `deleteMap`/`cloneMap` form actions (these are owner-only correctly, but don't use `requireMapAccess` helper — low risk, consistent with maps router).

---

## Phase 5 checklist — COMPLETE ✅

| Item | Status |
|---|------|
| **Embeddable maps** (`/embed/[token]`; bare canvas; `frame-ancestors *`; copy-embed button) | ✅ |
| **API keys** (`flk_` Bearer tokens; SHA-256 hash storage; hooks.server.ts auth; settings UI; 7 tests) | ✅ |
| **Audit logs** (hash-chain tamper-evident; `appendAuditLog` hooked into 11 mutations; `list`+`verify` tRPC; 9 tests) | ✅ |
| **Collaborator role enforcement** (`requireMapAccess` helper; viewer/commenter/editor enforced across maps/layers/features/geoprocessing/annotations/comments; editor page collab access; `maps.listCollaborating` + dashboard "Shared with me"; 11 access tests) | ✅ |

## Phase 5b checklist — IN PROGRESS 🚧

| Item | Status |
|---|------|
| Recurring bug-squash pass after each feature batch | ✅ |
| CI pipeline (GitHub Actions: lint, svelte-check, test, build) | ✅ |
| Vitest coverage thresholds (75/85/84/75) | ✅ |
| ADRs 004–006 (Martin, BullMQ, tRPC Fetch) | ✅ |
| Rate limiting on auth endpoints (10 req/min/IP) | ✅ |
| `maps.update` audit log (12 mutations now) | ✅ |
| TYPE_DEBT cast removal (hooks.server.ts, auth/index.ts) | ✅ |
| Playwright E2E tests | ✅ |
| pino structured logging | ✅ |
| GeoPackage / Shapefile / PDF export | ✅ |
| Admin panel + admin-cli.ts | ✅ |
| S3 / MinIO file storage | ⬜ |
| Tippecanoe tile pipeline | ⬜ |
