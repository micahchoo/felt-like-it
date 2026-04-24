# Adversarial API Testing — Readiness Plan

Scope: make the codebase ready for `/adversarial-api-testing`, which probes REST surfaces for IDOR, authz bypass, injection, concurrency, and input-limit failures. Focuses on Task 1 (two-tenant fixture) and Task 2 (API probe harness). Excludes functional-baseline-green (separate blocker) and the auth-matrix doc (follow-up).

## Current state

- Surface: 24 REST routes under `apps/web/src/routes/api/v1/**`, tRPC at `/api/trpc`, file upload routes, SSE progress endpoints.
- Playwright configured (`apps/web/playwright.config.ts`) with `webServer: pnpm dev` at `localhost:5173`. Tests live in `apps/web/e2e/`.
- Existing fixtures (`apps/web/e2e/fixtures/auth.ts`) authenticate via **UI form submission** — slow, single-user, not suited for API probes.
- `scripts/seed.ts` creates one demo user + one map. No second tenant.
- Auth is session-based (argon2 password, see `apps/web/src/lib/server/auth/`).

## Gap summary

| Gap | Needed for | Effort |
|---|---|---|
| Second seeded tenant (user B + owned map/layer/annotation) | IDOR, cross-tenant authz | S |
| API-level auth helper (cookie via POST, not UI click) | Every probe; UI auth is 10× too slow | S |
| Playwright API-request project (no browser) | Fast probe suite | S |
| Probe fixture file with `userA`, `userB`, `guestToken`, `apiKeyA` handles | Every probe | S |
| Route inventory machine-readable (JSON/YAML) | Probe loops (iterate & assert) | M |
| Known input limits declared (size, rate, pagination caps) | Oracle for limit probes | M |

## Task 1 — Two-tenant fixture

### 1a. Extend `scripts/seed.ts`

Add **alice** and **bob** alongside the existing `demo` user. Idempotent (skip if present).

```
alice@felt-like-it.local / alice  → owns Map "Alice's Map" with Layer + 3 features + 1 annotation
bob@felt-like-it.local   / bob    → owns Map "Bob's Map"   with Layer + 3 features + 1 annotation
                                    → plus one share-viewer token on Bob's map (read-only)
                                    → plus one API key with scope=read
```

IDs: use fixed UUIDs (in a constants export) so probes can reference them without re-fetching. Store in `apps/web/src/lib/server/db/fixtures.ts` — importable from seed and from Playwright setup.

### 1b. Reset-between-runs helper

`scripts/seed-reset.ts` — truncates Alice's/Bob's maps and re-seeds. Called from Playwright `globalSetup` so probe suites start from a known state (mutations in probe N don't leak into probe N+1).

### 1c. Constants module

```ts
// apps/web/src/lib/server/db/fixtures.ts
export const FIXTURE_USERS = {
  alice: { id: '…', email: 'alice@felt-like-it.local', password: 'alice' },
  bob:   { id: '…', email: 'bob@felt-like-it.local',   password: 'bob' },
} as const;
export const FIXTURE_MAPS = { aliceMap: '…', bobMap: '…' } as const;
export const FIXTURE_LAYERS = { aliceLayer: '…', bobLayer: '…' } as const;
export const FIXTURE_SHARE_TOKEN_BOB = '…';
export const FIXTURE_API_KEY_ALICE_READ = '…';
```

All values fixed (not randomUUID) — probes assert against them by literal ID.

## Task 2 — API probe harness

### 2a. Add Playwright API project

**Design note (api-designer):** Error responses use RFC 7807 Problem Details (`application/problem+json`). The harness asserts on status codes AND on `type` URIs in the body so probes can tell "401 because no cookie" apart from "401 because disabled account."

Amend `apps/web/playwright.config.ts` to add a second project:

```ts
projects: [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  {
    name: 'api',
    testDir: './e2e/api',
    use: { baseURL: 'http://localhost:5173', extraHTTPHeaders: { 'accept': 'application/json' } },
  },
],
```

Also set `globalSetup: './e2e/global-setup.ts'` — runs `seed-reset.ts`, waits for server readiness, asserts `/api/v1/maps` returns 401 unauth (sanity).

### 2b. Session-cookie auth helper

New file `apps/web/e2e/fixtures/api-auth.ts`:

```ts
export async function loginViaApi(request, email, password) {
  const res = await request.post('/api/v1/sessions', { data: { email, password } });
  expect(res.status()).toBe(201);
  return res.headers()['set-cookie']; // return cookie for reuse
}

export const apiTest = base.extend<{ alice: APIRequestContext; bob: APIRequestContext; anon: APIRequestContext }>({
  alice: async ({ playwright }, use) => { … loginViaApi … },
  bob:   async ({ playwright }, use) => { … loginViaApi … },
  anon:  async ({ playwright }, use) => { /* no cookie */ },
});
```

**Endpoint contract** (per api-designer constraints — resource-oriented, no verb URIs, RFC 7807 errors):

- `POST /api/v1/sessions` — create a session (login). Body: `{ email, password }` JSON.
- `201 Created` on success. Body: `{ user: { id, email, name } }`. `Set-Cookie` header carries the Lucia session.
- `400 Bad Request` / `401 Unauthorized` / `403 Forbidden` / `429 Too Many Requests` on failure, with `Content-Type: application/problem+json` and RFC 7807 body `{ type, title, status, detail }`.
- Re-uses `checkRateLimit(getClientAddress())` and `lucia.createSession` from the existing form action — the JSON endpoint is a parallel surface, not a bypass.

**Rejected alternative:** `/api/auth/login` — uses a verb in the URI, violates RESTful resource modeling, and doesn't live under the established `/api/v1/*` prefix.
**Rejected alternative:** forging session cookies via the `auth` module in test setup — faster but couples tests to internal lucia state; the endpoint is reusable for real clients (research-narratives REST integration per `project_rn_interop.md` memory).

### 2c. Route inventory

Generate `docs/testing/api-inventory.json` from the SvelteKit route tree:

```json
[
  { "path": "/api/v1/maps",              "methods": ["GET","POST"],  "auth": "session",     "ownership": "user"  },
  { "path": "/api/v1/maps/[mapId]",      "methods": ["GET","PATCH","DELETE"], "auth": "session-or-share-token", "ownership": "map" },
  …
]
```

Start hand-written (24 entries, one afternoon). Later: `scripts/gen-api-inventory.ts` walks `apps/web/src/routes/api/**/+server.ts` via AST. Probes iterate this file to guarantee *every* route is touched.

### 2d. Smoke probe file — `e2e/api/smoke.spec.ts`

Proves the harness works before writing real adversarial probes:

1. `anon` GET `/api/v1/maps` → 401.
2. `alice` GET `/api/v1/maps` → 200, contains `aliceMap`, does **not** contain `bobMap`.
3. `alice` GET `/api/v1/maps/{FIXTURE_MAPS.bobMap}` → 403 or 404 (assert which — this is the IDOR oracle).
4. `alice` POST `/api/v1/maps/{FIXTURE_MAPS.bobMap}/annotations` with valid body → 403/404, no row inserted (re-query as `bob`, count unchanged).

If all four pass, the harness is ready for `/adversarial-api-testing` to drive real probes against it.

## Deliverables & order

1. `apps/web/src/lib/server/db/fixtures.ts` — constants (new file).
2. `scripts/seed.ts` — extend to seed alice/bob (edit).
3. `scripts/seed-reset.ts` — truncate + re-seed (new file).
4. `apps/web/src/routes/api/v1/sessions/+server.ts` — JSON session-creation endpoint (new file).
5. `apps/web/playwright.config.ts` — add `api` project + `globalSetup` (edit).
6. `apps/web/e2e/global-setup.ts` — call `seed-reset`, server-ready ping (new file).
7. `apps/web/e2e/fixtures/api-auth.ts` — session-cookie fixtures (new file).
8. `apps/web/e2e/api/smoke.spec.ts` — 4-assertion harness proof (new file).
9. `docs/testing/api-inventory.json` — hand-written route catalog (new file, 24 entries).

## Estimate

- Task 1 (steps 1–3): ~1.5 hours.
- Task 2 (steps 4–8): ~2.5 hours.
- Inventory (step 9): ~1 hour.
- Total: **~5 hours** from clean baseline to adversarial-ready.

## Out of scope (separate tickets)

- Rate-limit declaration — needs product input on caps per session/IP.
- Auth matrix documentation — consolidate `middleware.ts` + `share-viewer.ts` logic into one doc; see `docs/api-auth-matrix.md` (future).
- Functional baseline green — 20+ test files currently modified uncommitted; must land or revert before probes run, or probe failures can't be distinguished from baseline breakage.
- AST-based route inventory generator — hand-written JSON is fine at 24 routes; revisit at 50+.

## Post-review fixes

Applied after advisor review:

- **Seed order bug** — `seedAdversarialFixtures` was originally called inside `seedDemo`, after the `if (demo exists) return` gate. On the 2nd `seed:reset`, alice/bob were deleted but never recreated (demo already existed → early return). Split into `seed()` → `{ seedDemo, seedAdversarialFixtures }` with independent gates. Per-tenant idempotency remains inside `seedAdversarialFixtures`.
- **Fixture credentials gate** — alice/bob and their API keys are committed plaintext; refuse to create them when `NODE_ENV=production` unless `SEED_FIXTURES=1`. `seed-reset.ts` auto-sets the opt-in because it is an explicit fixture operation.

## Wave 0 correction — Bearer-key harness

Discovered during W0: the `/api/v1/*` surface authenticates via `Authorization: Bearer flk_...` OR `?token=<share>`. Session cookies set by `/auth/login` are the UI's auth path and are NOT honored for the API (see `middleware.ts:resolveAuth`).

Consequence:

- Deleted `apps/web/src/routes/api/v1/sessions/+server.ts` — the JSON session-creation endpoint was unused by the harness and had no other caller.
- `apps/web/e2e/fixtures/api-auth.ts` now creates Playwright contexts with `extraHTTPHeaders.Authorization: Bearer <plaintext>` instead of posting to `/api/v1/sessions`.
- Fixtures expose write-scoped API keys for both alice and bob (`FIXTURE_API_KEY_{ALICE,BOB}_PLAINTEXT`) so probes can exercise mutations.
- Share-token auth is a separate fixture; smoke doesn't cover it yet.
- Response-shape hedge `body.maps ?? body.data ?? []` replaced with the real envelope `{ data, meta, links }` (from `middleware.ts:envelope`).

## Exit criterion

`pnpm --filter apps/web exec playwright test --project=api e2e/api/smoke.spec.ts` passes green on a clean database. At that point `/adversarial-api-testing` can be invoked and will have: two-tenant fixture, session-cookie auth, route inventory, and a running server — exactly what the skill expects.
