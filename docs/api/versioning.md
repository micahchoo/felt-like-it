# FLI REST API Versioning Policy

**Status:** Normative · **Owner:** `product-strategy` (seed `felt-like-it-1674`) · **Effective:** next release after merge

This document is the contract between FLI's `/api/v1/` surface and its external consumers. It says what we promise, how we evolve it, and what you can rely on.

**Scope.** This policy covers every route under `/api/v1/*` and every future `/api/v<N>/*`. tRPC routes under `/api/trpc/*` are **not** covered — they are internal to FLI's own web UI and may change freely.

---

## 1. Why we publish this

Our Platform Integrator persona (`product/strategy/personas/platform-integrator.md`) lists a stable, versioned contract as the *switch trigger* — the thing that has to be true before they can build against us. Without a published policy, every API change looks like a ticking time bomb to a downstream team. This document is what unblocks them.

---

## 2. Versions and what they mean

| Version | Path prefix | Status | Stability |
|---------|-------------|--------|-----------|
| v1 | `/api/v1/` | **current** | Stable. Breaking changes require a new major version. |
| vNext | `/api/v2/` | reserved | Opens only when a breaking change can't be fit into v1 without harm. |

**One current major at a time.** We do not run two breaking majors simultaneously. When v2 opens, v1 enters a deprecation window (see §6) and eventually retires.

**Version is chosen by URL path, not a header.** We picked path over `Accept:`/`X-API-Version:` because:
- curl, log scraping, and WAF rules all see it at a glance
- CDN cache keys segment cleanly
- OpenAPI gen output is one spec per major, not one spec with header-branches

Consumers may not pin to a minor or patch — those don't exist in the URL. The contract is: within a given major, the shape is backward-compatible per §3.

---

## 3. Breaking vs. non-breaking changes

### Non-breaking (allowed any time, no version bump)

- Adding a new endpoint.
- Adding a new **optional** request field.
- Adding a new response field.
- Adding a new enum variant to a response-only union (consumers must tolerate unknown variants — see §4).
- Relaxing a validation constraint (e.g. extending a length limit).
- Adding a new HATEOAS link in the `links` envelope.
- Adding a new error code **with a new HTTP status** (existing codes keep their status).
- Adding a new optional HTTP header to requests.
- Accepting a new representation via content negotiation.

### Breaking (requires major bump)

- Removing or renaming any field, endpoint, error code, or enum variant.
- Making an optional request field required.
- Tightening a validation constraint (shortening a max length, narrowing an enum).
- Changing a field's type, nullability, or semantic meaning.
- Changing the HTTP status returned for an existing error code.
- Removing or changing the shape of an envelope (`data`/`meta`/`links`/`error`).
- Changing authentication, rate-limit, or pagination mechanics.
- Changing the idempotency-key contract on `POST`.
- Changing cursor opacity or cursor semantics (see §3a).

### Grey-area, decided by rule of least surprise

- Adding a new **required** response field → we still call this non-breaking because the contract is "consumers may ignore unknown fields," but we flag it loudly in the changelog.
- Reordering array items when order wasn't documented → breaking if docs said "newest first" or similar; non-breaking if order was unspecified.
- Performance regressions (latency SLO) → not a contract break but tracked against KPI A1 in `product/strategy/kpis.md`.

### 3a. Opaque cursors

Pagination cursors (`meta.nextCursor`) are **opaque strings**. Integrators must not parse them. We reserve the right to change the encoding (today: base64url of `createdAt|id`, ms precision per `pagination.ts`) without a version bump as long as round-trip semantics are preserved: given a cursor produced by page *N*, passing it back returns page *N+1* without gaps or repeats.

---

## 4. Forward-compatibility rules for consumers

By integrating against v1 you agree to:

1. **Ignore unknown fields.** If a response grows a new key, your code must not crash.
2. **Tolerate unknown enum variants.** If `anchor.type` gains a new literal, your client must either render a sensible fallback or surface "unsupported" — not crash.
3. **Respect the envelope shape.** Read `data` / `meta` / `links` / `error` by name. Do not depend on field ordering or whitespace.
4. **Honor `If-Match` on write endpoints.** Optimistic concurrency is part of the contract; retries without a fresh version are your bug, not ours.
5. **Retry `5xx` with exponential backoff.** Idempotency keys (documented per endpoint) are safe to retry; non-idempotent writes without keys are not.
6. **Consume the deprecation signals.** See §6.

---

## 5. Release cadence

We cut releases whenever something non-breaking is ready. There is no fixed cadence. Each release produces:

- A git tag of the form `api-v1.<YYYYMMDD>.<n>`.
- A changelog entry at `docs/api/changelog.md` (created on first release) listing every endpoint/field added, deprecated, or documented-only.
- An updated OpenAPI 3.1 spec at `docs/api/openapi-v1.yaml` (owned by seed `felt-like-it-d40a`).

Consumers can watch the changelog. A future (post-d40a) work item will add a JSON feed.

---

## 6. Deprecation window

When we need to break something, we do it **on the next major** — we do not silently swap behaviour inside an existing major. The window for v1 → v2 cut-over is:

| Phase | Duration | What runs | What we publish |
|-------|----------|-----------|-----------------|
| **Announcement** | day 0 | v1 only | changelog entry; sentinel `Deprecation:` + `Sunset:` headers on all v1 responses per [RFC 8594](https://www.rfc-editor.org/rfc/rfc8594.html) and [RFC 9745](https://www.rfc-editor.org/rfc/rfc9745.html) |
| **Overlap** | ≥ 90 days | v1 + v2 concurrently | side-by-side OpenAPI specs; migration guide per changed endpoint |
| **Sunset** | hard cutover | v2 only | `410 Gone` on v1 with `Link: rel="successor-version"` pointing at v2 |

**Minimum overlap is 90 days**, measured from the first response that carries the `Deprecation:` header. For security-critical breaks, we reserve the right to shorten overlap to 30 days with the reason documented in the announcement.

RN (our reference consumer, `product/strategy/personas/spatial-researcher.md`) gets a second-opinion review on any announcement before it ships, because they are the canonical integrator today.

---

## 7. What is out of scope for this policy

- **tRPC routes** (`/api/trpc/*`) — internal to FLI's own UI, not a public surface.
- **Database schema** — irrelevant to external consumers; a schema migration can be non-breaking at the REST layer.
- **HTTP caching headers** (`ETag`, `Cache-Control`) — we may tune freely.
- **Request/response compression** — `Accept-Encoding` negotiation is a transport detail.
- **Rate-limit thresholds** — the mechanism is stable (429 with `Retry-After`), the numbers are tunable without a version bump.

---

## 8. Contract-test expectations (for our CI)

Every PR that touches `apps/web/src/routes/api/v1/**` or `packages/shared-types/src/**` must:

1. Run `apps/web/e2e/api/annotations-marketing.spec.ts` — must stay green.
2. Run the type-check across `packages/shared-types` and `apps/web` — zero errors.
3. For **any removal or rename** of a schema export / enum literal / endpoint: the PR must include a matching `CHANGELOG` entry marking it `BREAKING` and pointing at a `/api/v2/` target (or explicitly acknowledging the policy exception).

These gates are how we make this document enforceable rather than aspirational.

---

## 9. Precedents and open questions

**Precedents (already landed, retroactively codified here):**
- `Idempotency-Key` header on `POST` endpoints (seed `felt-like-it-aec9`, H5 security batch).
- If-Match on PATCH/DELETE for `/annotations/:id` (Felt-parity promise 10/11).
- Opaque base64url cursor (§3a; cursor fix landed with migration 0010 context).

**Open questions for cycle 02:**
- Per-endpoint OpenAPI tagging for SDK codegen (handoff to seed `felt-like-it-d40a`).
- Whether `Deprecation:` headers should appear in dev from day one to surface issues during internal testing.
- JSON feed of the changelog for automated consumers.

---

## 10. Glossary

- **Major** — the `vN` in the URL path.
- **Stable** — safe to build product features against; breaking changes require a new major.
- **Breaking change** — see §3.
- **Sunset** — the date after which a major stops accepting requests and returns `410 Gone`.
- **Deprecated** — still functional, but scheduled for sunset; responses carry the `Deprecation:` header.

---

## Source

- `product/strategy/roadmap.md` — RICE 4.0 placement.
- `product/strategy/personas/platform-integrator.md` — switch-trigger rationale.
- Industry references: RFC 8594 (Sunset), RFC 9745 (Deprecation), Stripe API versioning policy.
