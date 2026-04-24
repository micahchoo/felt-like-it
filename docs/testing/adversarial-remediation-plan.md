# Adversarial Remediation Plan

Addresses the 22 findings in `adversarial-findings.md` (7 HIGH, 10 MEDIUM, 5 LOW). Staged in 4 waves + 1 follow-up trigger. Each wave has 3 parallel tasks; each task has a Playwright `api`-project probe written **before** the fix (characterization first, fix flips it green).

**Guiding principles:**
- Auth primitives first — other fixes rely on them.
- Every bug becomes a regression test under `apps/web/e2e/api/`. Probe asserts vulnerable state; fix flips it green.
- LOW findings merge into their HIGH/MEDIUM cousins where they share code (L1→H2, L2→M8).
- M3 (distributed rate limiter) is a Wave-4 infra lift, not blocking anything else.

---

## Wave 0 — Validate the harness (prerequisite)

Not a fix. Proves the smoke suite is real before we start writing security regression tests on top of it. Without this, a red probe means nothing.

| Task | Artifact |
|------|----------|
| W0.1 | `pnpm dev:up && pnpm seed:reset && pnpm --filter apps/web exec playwright test --project=api e2e/api/smoke.spec.ts` green |
| W0.2 | Replace the response-shape hedge `body.maps ?? body.data ?? []` in `smoke.spec.ts` with the actual shape once observed |
| W0.3 | Run the suite twice in a row to prove `seed:reset` is idempotent (advisor-flagged concern) |

**Exit:** smoke green locally twice. Then Wave 1 starts.

---

## Wave 1 — Auth primitives (CROSS-CUTTING — do first)

Everything else assumes the auth layer is sound. Three parallel tracks; one serial follow-up.

### W1.A — API-key + password timing (H1, L2)

- **Probe** `e2e/api/h1-timing-apikey.spec.ts`: compare p95 of 1000 requests with `Authorization: Bearer flk_fixture…` (valid prefix, wrong suffix) vs 1000 with a random prefix. Document delta; after fix, delta must collapse.
- **Fix**
  - `apps/web/src/hooks.server.ts:20-27`, `api/v1/middleware.ts:56-63`: fetch by `apiKeys.prefix` (first 12 chars — already indexed). For each candidate row, `crypto.timingSafeEqual(Buffer.from(row.keyHash, 'hex'), Buffer.from(clientHash, 'hex'))`.
  - `auth/login/+page.server.ts:41-42` + `api/v1/sessions/+server.ts`: extract the dummy-hash logic into one helper; call it on the same branch structure whether user exists or not.
- **Size:** S (half-day).

### W1.B — Share-token format + lockout (H2, L1)

- **Probe** `e2e/api/h2-share-token-bruteforce.spec.ts`: 100 requests to `/share/{random}` must not return any 200; after the 5th attempt from the same IP for the same *token prefix*, returns 429.
- **Fix**
  - Validate at handler entry: `/^[A-Za-z0-9_-]{32,64}$/` regex → immediate 404 for malformed, no DB hit.
  - Per-token failure counter (in-memory Map keyed by `prefix`) — 5 misses / 15 min → 429.
  - `FIXTURE_SHARE_TOKEN_BOB` already 32+ chars; no fixture change needed.
- **Size:** S.

### W1.C — Cookie + CSRF (M7, M10)

- **Probe** `e2e/api/m7-csrf-origin.spec.ts`: POST to `/api/v1/maps` with valid session cookie AND `Origin: https://evil.example.com` → must be 403 after fix; currently succeeds.
- **Fix**
  - `lib/server/auth/index.ts`: explicit `httpOnly: true, secure: true, sameSite: 'strict'` on session cookie (M10).
  - `api/v1/middleware.ts`: on every mutation (POST/PATCH/DELETE), verify `request.headers.get('Origin')` matches the configured app origin. Reject with 403 otherwise. GET exempt (SameSite+Strict cookie covers it).
- **Risk:** `sameSite: strict` may break legitimate embeds — check `/embed/[token]` flow first. If it breaks, keep `lax` and rely entirely on the Origin check.
- **Size:** M (one day — needs to verify embed flow).

### W1.D — Account + signup (M8, M9) *(after W1.A merges — shared rate-limit module)*

- **Probe** `e2e/api/m8-signup-enum.spec.ts`: signup with `alice@felt-like-it.local` (known existing) vs random — response body + status must be identical. Probe `e2e/api/m9-account-lockout.spec.ts`: 5 wrong passwords for alice from 5 different IPs → 6th correct password is 429/locked.
- **Fix**
  - Schema: add `users.failed_login_count INTEGER DEFAULT 0, users.locked_until TIMESTAMPTZ`. Migration `0018_add_login_lockout.sql`.
  - `auth/login/+page.server.ts` + `api/v1/sessions/+server.ts`: increment counter on wrong password; clear on success; lock 15 min at 5. Same check in both login surfaces.
  - `auth/signup/+page.server.ts`: return generic "Check your email for a verification link" regardless of email existence.
- **Size:** M.

**Wave 1 exit:** all four probes red pre-fix, green post-fix. Run full smoke + new probes before starting Wave 2.

---

## Wave 2 — Input validation + DoS coverage (3 parallel tracks)

### W2.A — Field-level length caps (H6, H7, M1)

- **Probes**
  - `h6-comment-oversize.spec.ts`: POST comment body = 5001 chars → 422.
  - `h7-export-oversize.spec.ts`: POST export with `title` 1001 chars → 422.
  - `m1-annotation-patch-strict.spec.ts`: PATCH annotation with extra `id` field → 422.
- **Fix**
  - `api/v1/maps/[mapId]/comments/+server.ts`: `z.object({ body: z.string().max(5000) })`.
  - `api/v1/export/[layerId]/+server.ts`: `z.object({ screenshot: z.string().max(2_000_000), title: z.string().max(500) })`.
  - `api/v1/maps/[mapId]/annotations/[id]/+server.ts`: replace the `as never` spread with `z.object({...}).strict()`.
- **Size:** S — straightforward Zod additions.

### W2.B — Structural input shape (M2, L3, L4)

- **Probes**
  - `m2-json-depth.spec.ts`: POST annotation with 25-level-nested content → 422.
  - `l3-upload-layername.spec.ts`: upload with `layerName` 1000 chars → 422.
  - `l4-iiif-navplace.spec.ts`: mock IIIF manifest with malformed GeoJSON → annotation update rejected, no invalid navPlace persisted.
- **Fix**
  - Zod refinement helper `depthLimit(20)` in `lib/server/validation/depth.ts`; apply to annotation content + map viewport + layer style schemas.
  - `api/upload/+server.ts`: cap `layerName` at 120 chars via Zod.
  - `annotations/service.ts:fetchIiifNavPlace`: revalidate external GeoJSON with the same schema before persisting.
- **Size:** M — depth refinement is the novel piece.

### W2.C — Rate limit coverage gaps (H3, H4)

- **Probes**
  - `h3-export-rate-limit.spec.ts`: 200 rapid POSTs to `/api/v1/export` → some 429s.
  - `h4-sse-stream-cap.spec.ts`: alice opens 6 SSE streams to `/api/v1/export/progress` → 6th gets 429 (cap = 5).
- **Fix**
  - `api/v1/export/+server.ts:29`: add `await rateLimit(auth)` at top.
  - `api/v1/export/progress/+server.ts`: per-userId stream counter (module-scoped Map), reject above cap, server-side 5-min idle timeout on the interval.
- **Size:** S.

**Wave 2 exit:** 9 new probes green. No change to smoke.

---

## Wave 3 — Concurrency + integrity (3 tracks)

### W3.A — Idempotency keys (H5)

- **Probe** `h5-idempotency.spec.ts`: POST annotation twice with same `Idempotency-Key` header → second returns cached response, no second row created (verified via count query).
- **Fix**
  - New `lib/server/idempotency.ts`: middleware wrapping POST handlers. Key → `(status, body, cookies)` cached 24 h in Postgres `idempotency_keys` table (migration `0019`). Key scoped to userId.
  - Apply to `annotations POST` and `export POST`.
- **Size:** M — new middleware + migration.

### W3.B — Transactional wrapping (M4)

- **Probe** `m4-annotation-txn.spec.ts`: simulate changelog write failure (inject via test-only hook); annotation INSERT must roll back. Or simpler: assert `annotation_changelog` row count == `annotation_objects` row count after N mixed operations.
- **Fix** `lib/server/annotations/service.ts:{65,221,293}`: wrap insert+changelog, update+changelog, delete+changelog each in `db.transaction(async tx => {...})`.
- **Size:** S.

### W3.C — Optimistic concurrency correctness (M5, M6)

- **Probes**
  - `m5-patch-version-race.spec.ts`: 10 concurrent PATCHes with same `If-Match: "1"` — exactly one 200, nine 409.
  - `m6-delete-if-match.spec.ts`: DELETE without If-Match → 428 (Precondition Required); with stale version → 412.
- **Fix**
  - `annotations/service.ts:245`: change to `UPDATE ... SET version = version + 1 WHERE id = $id AND version = $expected RETURNING *`; empty result → surface 409.
  - `annotations/[id]/+server.ts:DELETE`: require `If-Match`; return 428 when absent, 412 when stale.
- **Size:** S.

**Wave 3 exit:** 4 new probes green. Full test suite green end-to-end.

---

## Wave 4 — Infrastructure (defer, bigger lift)

### W4 — Distributed rate limiter (M3)

Only one task, but it touches every route. Two options:

| Option | Pros | Cons |
|--------|------|------|
| Postgres-backed sliding window (existing dep) | No new infra | Extra DB roundtrip per request |
| Redis (new dep) | Microsecond limiter | New ops surface, another service in `dev:up` |

**Recommendation:** Postgres. The project already has a DB connection per request; add an `INSERT ... ON CONFLICT` into a `rate_limit_hits` table with a 1-second time bucket. Prune hourly via scheduled task.

**Blocking dependency:** requires a production deploy with >1 pod to matter. If the deploy target is still single-instance, W4 is a documentation-only change: mark M3 as "acknowledged, deferred until horizontal scaling" in the mulch decision record.

- **Size:** L (1–2 days), or XS (doc-only if single-pod).

---

## Follow-up trigger (L5)

When any of these endpoints ships — `/maps/[mapId]/+server.ts` PATCH/DELETE, `layers/[layerId]/+server.ts` PATCH/DELETE, `comments/[id]/+server.ts` PATCH/DELETE — **re-run `/adversarial-api-testing`** before merging. Mutation-IDOR is the single most likely category to regress. Recommend scheduling this via `/schedule` as a one-time follow-up when the PR touches those files.

---

## Cross-cutting deliverables

- **New files**
  - `apps/web/e2e/api/h1-…m6-….spec.ts` — 16 new probes across waves 1–3.
  - `apps/web/src/lib/server/validation/depth.ts` (W2.B).
  - `apps/web/src/lib/server/idempotency.ts` (W3.A).
  - Migrations `0018_add_login_lockout.sql`, `0019_add_idempotency_keys.sql`.
- **Shared helpers touched**
  - `hooks.server.ts` (W1.A, W1.C)
  - `api/v1/middleware.ts` (W1.A, W1.C, W1.D)
  - `lib/server/auth/index.ts` (W1.C)
  - `lib/server/rate-limit.ts` (W1.D) — gets account-aware variant.
  - `lib/server/annotations/service.ts` (W3.B, W3.C)
- **Mulch records on completion**
  - `ml record security --type decision --description "timing-safe API key check via prefix+timingSafeEqual"` + evidence commit.
  - One per wave, capturing the load-bearing decision.

---

## Ordering constraints (parallelism reality-check)

File-contention audit per wave — before the original plan claimed "3 parallel tracks per wave," which was over-optimistic.

| Wave | Shared files | Verdict |
|------|-------------|---------|
| W1.A/B/C/D | ALL touch `api/v1/middleware.ts` | **SERIAL** — A → B → C → D |
| W2.A vs B vs C | A: comments, export/[layerId], annotations/[id]. B: new `validation/depth.ts`, service.ts (navPlace only), upload. C: export root + progress. **No overlap.** | **3-PARALLEL** ✓ |
| W3.A vs B vs C | A: new `idempotency.ts`, migration, annotations POST, export POST. B: service.ts (txn wrapping, 3 methods). C: service.ts:245 + annotations/[id]. **B & C collide on service.ts.** | A ⊥ B ⊥ A ⊥ C — run as **(A ‖ B) → C** |
| W4 | M3 alone | **SINGLE** |

```
W0 (serial) ─► W1 (serial A→B→C→D) ─► W2.A ‖ W2.B ‖ W2.C ─► W3.A ‖ W3.B ─► W3.C ─► W4 (deferred)
```

- **Strict serial between waves.** Each wave's probes must be green before the next begins — regression coverage compounds, and a cross-wave regression is trivial to bisect when waves are committed separately.
- **Parallel inside a wave** only where file-contention is zero (W2 fully; W3 partially).
- **Shared prefix for parallel workers:** this plan + `adversarial-findings.md` + mulch `infrastructure` + `meta` domains (via `mulch-prime-cache.sh`) + one foxhound search envelope. Workers do NOT re-read shared files.

## Defaults chosen (proceeding unless overridden)

User invoked `/dispatching-parallel-agents` = implicit "go" signal. Pre-filled decisions:

1. **Order** — accept W0 → W1 → W2 → W3 as planned.
2. **SameSite (W1.C)** — keep `lax`, rely on Origin-check in middleware. Avoids embed-flow risk; can ratchet to `strict` in a follow-up once the embed surface is audited.
3. **W4 / M3** — **doc-only deferral.** Single-pod today; in-memory limiter is correct for that topology. Record decision in `.mulch/` with a re-evaluation trigger ("revisit when first second pod spins up").
4. **Commit cadence** — **one commit per wave (4 commits total + infra deferral doc).** Groups related work, keeps blast radius tight, enables `git bisect` on regression.

If any of these defaults is wrong, say so before Wave 0 runs — reversing commits is cheap but reversing decisions mid-wave isn't.

---

## Estimate

| Wave | Tasks | Size | Calendar |
|------|-------|------|----------|
| W0 | 3 | XS | 30 min |
| W1 | 4 | S, S, M, M | 1 day |
| W2 | 3 | S, M, S | ~half day |
| W3 | 3 | M, S, S | ~half day |
| W4 | 1 | L (or XS doc-only) | 1–2 days deferred |
| **Total (W0–W3)** | 14 | | **~2.5 days** focused |

Plus ~16 new probe tests (~20 lines each) — written first, flip green on fix.

---

## Decision points for the user

Before kicking off, confirm:

1. **Order** — accept W0 → W1 → W2 → W3 sequencing, or prioritize differently (e.g., "H3/H4 DoS first because production is single-pod and those are the easiest to exploit")?
2. **Strict SameSite (W1.C)** — acceptable risk of breaking `/embed/[token]` flow? If embed is load-bearing, fall back to Origin-check-only.
3. **W4 (M3)** — doc-only deferral (single-pod today) or build the Postgres-backed limiter now?
4. **Commit cadence** — one commit per task (14 commits), one per wave (4 commits), or one big branch (1 PR)?

On go-ahead, I'll start with Wave 0 and pause for verification after each wave.
