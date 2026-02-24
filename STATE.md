# Felt Like It — Build State

## Phase 3 / Granular Permissions — ✅ COMPLETE

**Tests:** 395 passing (shared-types: 44 · geo-engine: 134 · web: 217)
**svelte-check:** 0 errors · 0 warnings
**Lint (web):** 0 errors · 2 intentional warnings (console.log in hooks.server.ts + trpc/init.ts)

---

## Delta — this round

### Added
- `apps/web/src/lib/server/db/migrations/0004_add_collaborators.sql`
  - `map_collaborators` table: id, map_id (FK→maps CASCADE), user_id (FK→users CASCADE), role (text default 'viewer'), invited_by (FK→users SET NULL), created_at
  - UNIQUE(map_id, user_id); indexes on map_id + user_id
- `apps/web/src/lib/server/trpc/routers/collaborators.ts`
  - `collaborators.list({ mapId })` — ownership check; JOIN users; returns email+name+role
  - `collaborators.invite({ mapId, email, role })` — ownership; find user by email (NOT_FOUND); self-invite guard (BAD_REQUEST); duplicate guard (CONFLICT); insert
  - `collaborators.remove({ mapId, userId })` — ownership check; delete
  - `collaborators.updateRole({ mapId, userId, role })` — ownership check; update + returning (NOT_FOUND if no row)
- `apps/web/src/lib/components/map/CollaboratorsPanel.svelte`
  - Invite form: email input + role select (viewer/commenter/editor) + Invite button
  - Collaborator list: name, email, role selector (inline change), remove (×) button
  - Error messages thread back human-readable tRPC messages (e.g. "No account found with that email.")
- `apps/web/src/__tests__/collaborators.test.ts` — 13 tests
  - `list`: returns collaborators, empty array, NOT_FOUND
  - `invite`: invites, NOT_FOUND (map), NOT_FOUND (email), BAD_REQUEST (self), CONFLICT (duplicate)
  - `remove`: removes, NOT_FOUND
  - `updateRole`: updates, NOT_FOUND (map), NOT_FOUND (no collaborator row)

### Changed
- `apps/web/src/lib/server/db/schema.ts` — `mapCollaborators` table + `MapCollaboratorRow`/`NewMapCollaborator` exports
- `apps/web/src/lib/server/trpc/router.ts` — `collaborators: collaboratorsRouter`
- `apps/web/src/lib/components/map/MapEditor.svelte`
  - `showCollaborators` state; "Collaborators" toolbar button (people icon); CollaboratorsPanel panel (w-72, right side)
- `scripts/migrate.ts` — added `'0004_add_collaborators.sql'`
- `docs/ROADMAP.md` — Granular permissions marked ✅

### Fixed
- ESLint `svelte/require-each-key`: `{#each ROLES as r}` → `{#each ROLES as r (r)}` in CollaboratorsPanel

---

## Gaps — known blockers / debt

- **None blocking merge.** All tests green, type-check clean, lint clean.
- Collaborator roles are stored but NOT enforced on existing tRPC procedures (comments.create, features.upsert, etc.) — data model is in place, enforcement is a Phase 4/5 hardening task.
- No email notification on invite — would require SMTP setup (out of Phase 3 scope).
- `events.list` has no pagination beyond `limit`.
- Worker lint not counted — pre-existing `no-undef`.
- `TODO(loop):` multi-table GeoPackage import still first-table-only.

---

## Phase 3 checklist (COMPLETE)

| Item | Status |
|---|---|
| **Activity feed** | ✅ |
| **Comment threads** | ✅ |
| **Guest commenting** | ✅ |
| **Granular permissions** (map_collaborators table; list/invite/remove/updateRole tRPC; CollaboratorsPanel.svelte) | ✅ |
| Yjs CRDT real-time editing | ⬜ (deferred — requires WebSocket infrastructure) |
| Presence indicators | ⬜ (depends on Yjs) |
| Team library | ⬜ (deferred to Phase 4) |
