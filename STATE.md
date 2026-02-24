# Felt Like It — Build State

## Phase 5 — Enterprise Polish 🚧 IN PROGRESS

**Tests:** 296 passing (web) · shared-types: 96 · geo-engine: 178 — total: 570
**svelte-check:** 0 errors · 0 warnings
**Lint (web):** 0 errors · 0 warnings

---

## Delta — this round (Bug-squash: collaborator access + coverage gaps)

### Fixed
- `apps/web/src/routes/(app)/map/[id]/+page.server.ts`
  - Editor page now allows collaborators: removed owner-only filter; added inline two-query collab check (owner fast-path → collab record fallback → 404)
- `apps/web/src/lib/server/trpc/routers/comments.ts`
  - `comments.list`: replaced owner-only check with `requireMapAccess(viewer+)`
  - `comments.create`: replaced owner-only check with `requireMapAccess(commenter+)`
- `apps/web/src/lib/server/trpc/routers/layers.ts`
  - `layers.update`: added null guard before spread — throws INTERNAL_SERVER_ERROR if `.returning()` is empty
- `apps/web/src/hooks.server.ts`
  - Added `TYPE_DEBT` comment on `userRow as unknown as User` cast

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
- Worker lint not counted — pre-existing `no-undef`.
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

## Phase 5b checklist — NEXT ⬜

| Item | Status |
|---|------|
| Recurring bug-squash pass after each feature batch | ⬜ |
| CI pipeline (GitHub Actions) | ⬜ |
| Playwright E2E tests | ⬜ |
| Vitest coverage thresholds | ⬜ |
| ADRs 004–006 | ⬜ |
| pino structured logging | ⬜ |
| Rate limiting | ⬜ |
| GeoPackage / Shapefile / PDF export | ⬜ |
| Admin panel + admin-cli.ts | ⬜ |
| S3 / MinIO file storage | ⬜ |
| Tippecanoe tile pipeline | ⬜ |
