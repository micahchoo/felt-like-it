# Adversarial API Testing — Findings (Static Analysis)

Date: 2026-04-24
Source: `/adversarial-api-testing` run against `apps/web/src/routes/api/v1/**` without a running server. Four parallel audits: IDOR, input sanitization, concurrency, middleware/auth.

**Summary:** 7 HIGH, 10 MEDIUM, 5 LOW, 0 CRITICAL.
**Big picture:** authz posture is strong (no exploitable IDOR found). Weakest tiers are rate-limit coverage on export/SSE endpoints, timing-sensitive auth primitives, and missing idempotency + transaction boundaries.

Findings reference file:line as of commit `8a9aae9`. Re-verify before fixing — code moves.

---

## HIGH

### H1 — API key hash comparison is not timing-safe
- `apps/web/src/hooks.server.ts:20-27`
- `apps/web/src/routes/api/v1/middleware.ts:56-63`
- `createHash('sha256').update(rawKey).digest('hex')` → `eq(apiKeys.keyHash, hash)`. DB layer compares with plain string equality. Short-circuits on first mismatched byte.
- **Exploit sketch:** Attacker brute-forces key bytes via response-time delta. At 1 ms resolution over a network, per-byte signal is shallow but extractable on co-located attacker.
- **Fix:** Fetch candidate rows by `prefix` (first 12 chars, already indexed), then `crypto.timingSafeEqual()` the remaining hash in Node.

### H2 — Share-token brute-force protection absent
- `apps/web/src/routes/api/v1/middleware.ts:66-71`
- Direct `eq(shares.token, token)`, no minimum length enforcement, no per-token lockout. 30 req/s limit permits ~2.5M guesses/day per share.
- **Exploit sketch:** Dictionary-attack short / low-entropy tokens generated before any length policy was in place.
- **Fix:** Validate `token.length >= 32` and `[a-zA-Z0-9_-]` at handler entry → immediate 404 for malformed. Add per-token attempt counter → 429.

### H3 — Export POST lacks rate limit
- `apps/web/src/routes/api/v1/export/+server.ts:29`
- No `rateLimit(auth)` call. Every sibling mutation endpoint has one.
- **Exploit sketch:** `for (let i=0; i<10000; i++) fetch('/api/v1/export', {...})` → 10k queued jobs, worker DoS, disk fill.
- **Fix:** Add `await rateLimit(auth)` at handler top; cap concurrent in-flight exports per user (e.g. 3).

### H4 — Export SSE stream has no concurrent-stream cap
- `apps/web/src/routes/api/v1/export/progress/+server.ts:1-92`
- Client can open N streams; each polls DB every 1000 ms. Interval continues on client crash (cleanup relies on `request.signal.abort`).
- **Exploit sketch:** One authenticated user opens 1000 SSE connections → 1000 DB queries/s, connection-pool exhaustion.
- **Fix:** Track active streams per userId in a Map; reject with 429 above threshold; add server-side idle timeout.

### H5 — POST endpoints have no idempotency-key support
- `apps/web/src/routes/api/v1/maps/[mapId]/annotations/+server.ts:37`
- `apps/web/src/routes/api/v1/export/+server.ts:29`
- Double-submit on network retry creates duplicate resources.
- **Exploit sketch:** Network blip triggers client auto-retry while original is still being processed → two annotations / two export jobs.
- **Fix:** Accept `Idempotency-Key` header; cache `{key → response}` for 24h; return cached response on repeat.

### H6 — Comment body has no max length
- `apps/web/src/routes/api/v1/maps/[mapId]/comments/+server.ts:POST (~line 78)`
- Type-checks that `body.body` is a string, then inserts. `stripNullBytes` applied but no cap.
- **Exploit sketch:** `POST { "body": "x".repeat(50_000_000) }` → 50 MB row written to `comments.body`.
- **Fix:** Enforce `body.length <= 5000` at handler (matches client expectation) → 422.

### H7 — Export POST `screenshot` + `title` fields unvalidated
- `apps/web/src/routes/api/v1/export/[layerId]/+server.ts:POST (~line 63)`
- Spreads `{ screenshot, title }` directly into `exportAsPdf()`. No schema, no size cap.
- **Exploit sketch:** `{ "title": "x".repeat(1_000_000) }` in a PDF-rendering pipeline — layout/metadata DoS; or `"screenshot": "data:..." megabyte blob` consumed by worker.
- **Fix:** Zod schema with `.max()` on both fields at handler entry.

---

## MEDIUM

### M1 — Annotation PATCH field-spread trusts service layer
- `apps/web/src/routes/api/v1/maps/[mapId]/annotations/[id]/+server.ts:PATCH (~line 51)`
- Handler whitelists `anchor` + `content` only, but casts via `as never` — extra fields in body could be picked up if service schema widens later.
- **Fix:** Zod `.strict()` on the PATCH body schema so extra fields are rejected at 422, not passed through.

### M2 — Nested JSON depth not bounded
- Annotation content + GeoJSON navPlace accept arbitrarily deep structures.
- **Fix:** Depth-limit check in Zod refinement (e.g. max depth 20) on jsonb-bound fields.

### M3 — In-memory rate limiter doesn't scale horizontally
- `apps/web/src/routes/api/v1/middleware.ts:60`
- Per-instance sliding window. Multi-pod deploy = effective limit × pod count.
- **Fix:** Back by Redis or Postgres (existing dep). Document the gap until then.

### M4 — Annotation mutations lack transactional wrapping
- `apps/web/src/lib/server/annotations/service.ts:65-150` (create), `221-291` (update), `293-338` (delete)
- Insert/update annotation and write to `annotation_changelog` are separate queries. Crash between = partial state.
- **Fix:** Wrap the pair in `db.transaction(async tx => { ... })`.

### M5 — PATCH concurrency race on version check
- `apps/web/src/lib/server/annotations/service.ts:245`
- Two concurrent PATCHes may both read the same old `version`, both increment to `version+1`. Second write races first.
- **Fix:** `UPDATE ... SET version = version+1 WHERE id = $id AND version = $expected RETURNING *` — if no row returned, surface 409.

### M6 — DELETE has no optimistic-concurrency guard
- `apps/web/src/routes/api/v1/maps/[mapId]/annotations/[id]/+server.ts:102-137`
- DELETE doesn't require `If-Match`. Two authors racing both get 204; changelog gets one entry, delete happens at most once — but auditability weakens.
- **Fix:** Accept `If-Match: "<version>"` header on DELETE; 412 when mismatched.

### M7 — CSRF on JSON API surface (SameSite=Lax)
- `apps/web/src/lib/server/auth/index.ts:16`
- SvelteKit's built-in CSRF guard exempts JSON; Lucia cookie is `SameSite=Lax`. Combined with JSON endpoints that mutate, cross-origin form POST with `application/json` body is plausible in older browsers.
- **Fix:** `SameSite=Strict`, or verify `Origin`/`Referer` header on every `/api/v1/*` mutation. Prefer Origin check — avoids breaking embeds that legitimately set SameSite=Lax.

### M8 — Signup email enumeration
- `apps/web/src/routes/auth/signup/+page.server.ts:42-43`
- Returns distinguishable error when email already exists.
- **Fix:** Return a generic "Check your email for a verification link" regardless; send the link only if new.

### M9 — No account-level login lockout
- `apps/web/src/lib/server/rate-limit.ts`
- Rate limit is IP-only. Failed logins don't lock the account; password spray across IPs still works.
- **Fix:** Add `users.failed_login_count` column, increment on wrong password, lock at 5 attempts/15 min, unlock via email.

### M10 — Session cookie HttpOnly not explicitly asserted
- `apps/web/src/lib/server/auth/index.ts`
- Lucia defaults to `httpOnly: true` but the project does not set it explicitly. Future refactor could drop it.
- **Fix:** Explicit `httpOnly: true, secure: true, sameSite: 'strict'` on `sessionCookie.attributes`.

---

## LOW

### L1 — Share-token format validation missing
- `apps/web/src/routes/(public)/share/[token]/+page.server.ts:8`
- **Fix:** Regex guard before DB hit. Tied to H2 fix.

### L2 — Login dummy-hash timing slightly imperfect
- `apps/web/src/routes/auth/login/+page.server.ts:41-42`
- Argon2 branch vs DB-miss branch timing differs in the high microsecond range. Practical exploitability near zero.

### L3 — File-upload `layerName` unbounded
- `apps/web/src/routes/api/upload/+server.ts`
- Accepted into import job without cap. Stored in text column — no SQL risk, but filenames in exports could inherit.

### L4 — IIIF `navPlace` GeoJSON not re-validated on external fetch
- Annotation `fetchIiifNavPlace` writes external GeoJSON to jsonb without Zod-revalidating.
- **Fix:** Run the same schema after fetch.

### L5 — Endpoints not yet exported for maps / layers / comments mutations
- `maps/[mapId]/+server.ts`, `layers/[layerId]/+server.ts`, `comments/[id]/+server.ts` export only GET.
- Not a vulnerability — flag: **when they're added, re-run this audit**; mutation-path IDOR is the easiest to regress into.

---

## Positive findings (the strong floor)

- **IDOR posture is correct.** All `/maps/[mapId]/*/[id]` mutation handlers call `requireMapAccess(auth.userId, mapId, role)` AND cross-reference `child.mapId === url.mapId`. This is the hardest category to get right and it is.
- **Null-byte stripping** (`stripNullBytes()`) applied to every JSON-parsing POST/PATCH.
- **Zod validation** on every mutating endpoint (the gaps above are field-level, not layer-level).
- **Rate limit** applied on read/write paths except the two flagged in H3/H4.
- **Disabled accounts** rejected in hooks + middleware.
- **API key scope** (`read` / `write`) enforced via `requireScope()`.
- **Share tokens** are hard-coded read-only — no mutation risk from that auth class.
- **Argon2** password hashing with 19 MiB / t=2 parameters.

---

## Next steps

1. HIGHs (H1–H7) → one seeds issue each (see `.seeds/issues.jsonl`).
2. MEDIUMs → one batched hardening issue (`adversarial-hardening-medium`).
3. LOWs → log-only; revisit after HIGH/MEDIUM landed.
4. Re-run this audit when any of the currently-GET-only endpoints gains PATCH/DELETE — mutation IDOR is the category most likely to regress.
5. Live-run layer: once `smoke.spec.ts` is green, write probes for each HIGH finding as a Playwright `api`-project spec. Each probe asserts the vulnerable state; a fix flips it green.
