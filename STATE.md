# Felt Like It — Build State

## Phase 5 — Enterprise Polish 🚧 IN PROGRESS

**Tests:** 525 passing (shared-types: 96 · geo-engine: 178 · web: 251)
**svelte-check:** 0 errors · 0 warnings
**Lint (web):** 0 errors · 0 warnings

---

## Delta — this round (API keys)

### Added
- `apps/web/src/lib/server/db/migrations/0006_add_api_keys.sql`
  - `api_keys` table: `id`, `user_id` (FK → users CASCADE), `name`, `key_hash` (UNIQUE), `prefix`, `last_used_at`, `created_at`
  - `api_keys_key_hash_idx` (UNIQUE), `api_keys_user_id_idx`
- `apps/web/src/lib/server/db/schema.ts`
  - `apiKeys` pgTable + `ApiKeyRow` / `NewApiKey` type exports
- `apps/web/src/lib/server/trpc/routers/apiKeys.ts`
  - `apiKeys.list` — returns all key records for the caller (no hashes)
  - `apiKeys.create` — generates `flk_<64-hex>` key, stores SHA-256 hash, returns plaintext once
  - `apiKeys.revoke` — ownership-checked delete
- `apps/web/src/__tests__/api-keys.test.ts`
  - 7 tests: list (2), create (3), revoke (2)

### Changed
- `apps/web/src/lib/server/trpc/router.ts`
  - Registered `apiKeys: apiKeysRouter`
- `apps/web/src/hooks.server.ts`
  - Bearer auth block before session-cookie block
  - Parses `Authorization: Bearer flk_…`, SHA-256 hashes it, looks up in `api_keys`
  - Sets `event.locals.user` from DB user row; `event.locals.session = null`
  - Fire-and-forget `last_used_at` update on successful auth
- `apps/web/src/routes/(app)/settings/+page.server.ts`
  - `load()` now also returns `apiKeys` list (id, name, prefix, lastUsedAt, createdAt)
  - New `createKey` form action: generates key, stores hash, returns `{ newKey, keyName }`
  - New `revokeKey` form action: ownership-checked delete
- `apps/web/src/routes/(app)/settings/+page.svelte`
  - New "API Keys" section between Password and Danger Zone
  - One-time key banner when `form.newKey` is set (copy button with 2-second flash)
  - Key list with prefix, name, created, last-used, and Revoke button per row
  - Create-key form (name input + "Create key" button)

---

## Gaps — known blockers / debt

- **None blocking merge.**
- `TODO(loop):` multi-table GeoPackage import (escalated — structural worker change, not blocking)
- Collaborator roles stored but NOT enforced on tRPC procedures — Phase 5 hardening item.
- Worker lint not counted — pre-existing `no-undef`.
- Measurement tool: live/interactive measurement not implemented — only final shape is measured.
- `GeoAggregateBaseSchema` used in discriminated union (not refined); cross-field invariant at router level only.
- `/embed/[token]` frame header: self-hosters using nginx with `add_header X-Frame-Options SAMEORIGIN` at proxy level must remove that header for embed to work.

---

## Phase 5 checklist

| Item | Status |
|---|------|
| **Embeddable maps** (`/embed/[token]`; bare canvas; `frame-ancestors *`; copy-embed button) | ✅ |
| **API keys** (`flk_` Bearer tokens; SHA-256 hash storage; hooks.server.ts auth; settings UI; 7 tests) | ✅ |
| SSO / SAML (OIDC + SAML2 via Arctic) | ⬜ |
| Audit logs (tamper-evident append-only) | ⬜ |
| Raster support (GeoTIFF + COG tiles) | ⬜ |
| Helm chart | ⬜ |
| Plugin system | ⬜ |
| Regional hosting docs | ⬜ |
