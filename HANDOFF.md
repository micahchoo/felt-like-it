# Handoff

## Goal
Comprehensive stress testing of REST API v1, adversarial security testing, and bug fixes.

## Branch
`fix/api-adversarial-bugs` — based on `master`

## Progress
- ✅ Dev environment setup — Docker services running, dev server on port 5174
- ✅ Comprehensive stress test script (`scripts/stress-test-api.ts`) — 17 phases, 1900+ test cases
- ✅ Eval protocol assessment — 25 coverage expectations, 22/25 pass
- ✅ **FIXED: IDOR in annotation PATCH/DELETE** — cross-map annotation modification/deletion
- ✅ **FIXED: Null byte crashes** — `\0` in text/jsonb fields caused PostgreSQL 500s
- ✅ **FIXED: Invalid parentId crash** — FK violation on annotation create returned 500
- ⬚ Lost updates on concurrent PATCH (49/50 fail) — design decision needed
- ⬚ Slowloris — server holds stalled connections for full request timeout
- ⬚ No double-submit protection (idempotency keys)
- ⬚ Terra Draw bug from prior session (still unresolved)
- ⬚ Deploy to production

## Stress Test Script
`scripts/stress-test-api.ts` — run with `npx tsx scripts/stress-test-api.ts`

Defaults: 100 users, 100 maps, 50k annotations, 100k features. Requires `API_RATE_LIMIT=100000` in `apps/web/.env`. Config via env vars: `BASE_URL`, `USERS`, `MAPS`, `ANNOTATIONS`, `COMMENTS`, `FEATURES`, `CONCURRENCY`, `RACE_CONCURRENCY`.

17 phases: scope enforcement, multi-user reads, annotations, comments, features, read-under-load, race conditions, access control, files, export, malformed data, pagination, ETag, rate limiting, endpoint coverage, adversarial round 1 (pool exhaustion, thundering herd, unicode bombs, slowloris, forged cursors, CRUD storm), adversarial round 2 (IDOR, prototype pollution, HTTP method confusion, integer overflow, circular parentId, concurrent deletion, double-submit, null bytes).

## Key Commit
- `b62fa3d` fix(api): IDOR, null byte crashes, and invalid parentId in annotations

## Remaining Bugs

### Lost Updates (B1) — design decision needed
50 concurrent PATCHes: only 1 succeeds. Endpoint has If-Match/optimistic concurrency but it's optional. Without the header, last-write-wins with no conflict detection. Decision: enforce If-Match, or accept last-write-wins?

### Slowloris (B2) — LOW
Stalled upload body holds connection for ~10s. Mitigate at reverse proxy level.

### No Idempotency (B3) — LOW
Identical POSTs both create separate resources. Standard REST behavior.

## What Worked
- Batch SQL setup (100 users + 100 maps + 9900 collabs in seconds)
- Adversarial categories (IDOR, null bytes, forged cursors) found real security bugs
- `stripNullBytes()` middleware helper for boundary sanitization
- Eval protocol structured coverage gaps

## Context Files
- `scripts/stress-test-api.ts` — comprehensive stress test
- `apps/web/src/routes/api/v1/maps/[mapId]/annotations/[id]/+server.ts` — IDOR fix
- `apps/web/src/routes/api/v1/middleware.ts` — stripNullBytes()
- `apps/web/src/routes/api/v1/maps/[mapId]/annotations/+server.ts` — parentId fix
- `apps/web/.env` — API_RATE_LIMIT=100000

## Next Steps
1. Merge `fix/api-adversarial-bugs` to master
2. Decide on lost updates — enforce If-Match or accept last-write-wins
3. Terra Draw bug — drawing tool dies after feature selection
4. Deploy to production — push, run migration 0014, rebuild container
