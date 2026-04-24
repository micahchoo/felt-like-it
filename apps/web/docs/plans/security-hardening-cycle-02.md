# Cycle 02 — Security Hardening + Felt-parity Tail

> **⚠ OBSOLETE — DO NOT EXECUTE BUCKET A.**
>
> Discovered 2026-04-24 (commit-time audit): all 7 H-bugs and 8 of 10 MEDIUMs from
> the `adversarial-2026-04-24` sweep were already shipped in commits `70a7058` (W1),
> `719a119` (W2), `f6f5bb9` (W3), `1dd1735` (W4 close-out). The seeds carrying these
> findings (`a721`, `a9ad`, `4971`, `f6b0`, `aec9`, `2b9b`, `b5dc`, `5102`, `05dd`)
> were never closed when the work landed — Bucket A here was authored against stale
> seed bodies, not against the source-of-truth `docs/testing/adversarial-remediation-plan.md`.
>
> **Canonical security state lives in `docs/testing/adversarial-remediation-plan.md`.**
>
> What remains real from this doc:
> - Bucket B Wave 4 — only `135c` (M9 account-lockout decision) and the 5 anti-pattern
>   seeds (`0524 fire-and-forget`, `8bfc catch-all`, `3e35 console-only-error`,
>   `a052 untested-churn`, `3f7f impact-scope`, `f645 silent-catch`).
> - Bucket C — `c07b` drag-to-move docs/decision, `2b5c` dash limit doc, `baa4` Phase 3 epic.
> - Bucket D — `d40a` OpenAPI + SDK.
>
> **Lesson recorded:** before composing a multi-wave plan from a seeds queue, verify
> each seed's claim against the code (commit log + grep for the cited file:line). A
> stale needs-triage queue can encode "found and unfixed" or "found, fixed, never
> closed" — only the source code distinguishes them.
>
> Body below preserved for history. Skip to the bottom for the corrected scope.

**Original thesis (now stale).** Felt-parity Cycle 01 closed (audit 22/22, unified-annotations Phase 1+2 shipped). The freshest unblocked queue is the **adversarial-2026-04-24** sweep — 7 P1 bugs with concrete file:line locations and a remediation doc already in tree (`docs/testing/adversarial-findings.md`, `docs/testing/adversarial-remediation-plan.md`). This cycle ships those, batches the remaining adversarial follow-ups, and tails Felt-parity. The eight `audit-2026-03-30` flow tasks (F09-F14, N01-N03) stay deferred — they're flow-architecture work that needs a dedicated discovery cycle, not a hardening cycle.

**Status entry-point:** `master` @ `3199d29` (post-triage, queue clean, 23 ready).

---

## Decomposition (3 buckets, 6 waves)

```
Bucket A — Security hardening      (Waves 1-3, 7 P1 + 1 P2)
Bucket B — Adversarial cleanup     (Wave 4, 4 items P2/P3)
Bucket C — Felt-parity tail        (Waves 5-6, 4 items P2/P3)
```

Waves are sized to fit in one focused session each (≤5 files touched, single thematic slice per CLAUDE.md). Bucket A is sequential (Wave 1 → 2 → 3); Buckets B/C can be picked up independently or interleaved.

---

## Bucket A — Security Hardening

### Wave 1 — Auth surface (H1 + H2)
**Goal:** make API-key compare timing-safe and gate share-token brute-forcing.

| ID | Title | File | Fix |
|----|-------|------|-----|
| `a721` | H1: API key hash compare not timing-safe | `apps/web/src/hooks.server.ts:20-27`, `apps/web/src/routes/api/v1/middleware.ts:56-63` | Fetch row by `key_prefix`, then `crypto.timingSafeEqual(buf(stored), buf(computed))` on the sha256 remainder. |
| `a9ad` | H2: Share-token brute-force absent | `apps/web/src/routes/api/v1/middleware.ts:66-71` | Reject tokens shorter than 32 chars (return 401, not 404 — same as auth). Add per-token failure counter (Redis or in-memory LRU) + lockout after N fails / window. |

**Acceptance:**
- Adversarial test (or new e2e) asserts H1 mitigation: equal-length wrong key takes the same wall-clock time (±2σ) as a correct prefix + wrong remainder. Microsecond timing in JS is noisy — assert *no early-return path*, not absolute timing.
- e2e for H2: 11 share-token requests with wrong token from one IP → 11th returns 429 (not 404). Short-token (<32) returns 401 immediately.
- Reference: `docs/testing/adversarial-findings.md#h1`, `#h2`.

**Size:** ~3 files, 1 session.

### Wave 2 — Export route hardening (H3 + H4 + H7)
**Goal:** the export surface stops being a DoS / unvalidated-input vector.

| ID | Title | File | Fix |
|----|-------|------|-----|
| `4971` | H3: Export POST no rate limit | `apps/web/src/routes/api/v1/export/+server.ts:29` | Add `rateLimit(auth)` (already shared by other handlers). Per-user in-flight cap: count `WHERE user_id=$1 AND status IN ('queued','running')` before enqueuing; reject if > N (5?). |
| `f6b0` | H4: Export SSE no concurrent-stream cap | `apps/web/src/routes/api/v1/export/progress/+server.ts:1-92` | Track open streams per `userId` (in-memory Map). Limit to N (3?). Idle timeout disconnects after 60s of no progress. |
| `b5dc` | H7: Export POST screenshot/title unvalidated | `apps/web/src/routes/api/v1/export/[layerId]/+server.ts:POST` | Wrap body in Zod: `screenshot: z.string().max(50_000)` (base64), `title: z.string().min(1).max(200)`. Reject 422 with field name. |

**Acceptance:**
- e2e: 11 rapid export POSTs from one user → 429 on the 11th OR a queue-full 422.
- e2e: 5 concurrent SSE connects from one user → 5th gets 429 / connection-refused; idle stream is closed after 60s.
- e2e: 100KB screenshot field → 422; 1MB title → 422.
- Reference: `docs/testing/adversarial-findings.md#h3`, `#h4`, `#h7`.

**Size:** ~3 files + 1 e2e spec, 1 session.

### Wave 3 — Cross-cutting hygiene (H5 + H6)
**Goal:** idempotency on POST + bound input lengths everywhere we missed.

| ID | Title | File | Fix |
|----|-------|------|-----|
| `aec9` | H5: No Idempotency-Key on POST | `apps/web/src/routes/api/v1/maps/[mapId]/annotations/+server.ts:POST`, `apps/web/src/routes/api/v1/export/+server.ts:POST` | Read `Idempotency-Key` header. Hash (key + userId + path + body) → cache (key→responseEnvelope) for 24h in `idempotency_keys` table (migration 0019). Return cached response if key seen. |
| `2b9b` | H6: Comment POST no max length | `apps/web/src/routes/api/v1/maps/[mapId]/comments/+server.ts:POST` | Replace `z.string()` with `z.string().min(1).max(5000)`. Audit other Zod string schemas in `comments/`, `annotations/`, `export/` for missing `.max()`. |

**Acceptance:**
- e2e: same Idempotency-Key on annotation POST → second request returns the **first request's** envelope, no duplicate row. Different key → new row.
- e2e: 100KB comment body → 422.
- Sweep: grep for `z.string()` without chained `.max()` in handler bodies; document any intentional unbounded fields.
- Reference: `docs/testing/adversarial-findings.md#h5`, `#h6`.

**Size:** new migration + ~4 files + e2e, 1 long session OR 2 short.

---

## Bucket B — Adversarial Cleanup

### Wave 4 — Lower-priority adversarial backlog
| ID | Title | Approach |
|----|-------|----------|
| `135c` | M9 follow-up: account-level login lockout | Read `docs/testing/adversarial-remediation-plan.md` §Wave 1 close-out. Decide: ship or close as accepted-risk (the "attacker locks victim" DoS is real). |
| `5102` | Adversarial MEDIUM batch | Read seed body to enumerate; batch fix in 1 session. |
| `05dd` | Adversarial LOW batch | Same. |
| `f645` | Anti-pattern: silent-catch (1 finding) | One occurrence — read it, decide if it's a real silent failure or a justified swallow. If real, fix + add a project-wide lint rule per CLAUDE.md "Bug fix → can a project-wide rule prevent this category". |

**Size:** 1-2 sessions depending on batch contents.

---

## Bucket C — Felt-parity Tail

### Wave 5 — Known limitations + UX gaps
| ID | Title | Approach |
|----|-------|----------|
| `c07b` | Drag-to-move feature: architectural gap | Decision: (a) update `docs/guides/maps-and-layers.md` to remove the implied capability, OR (b) build a feature-edit mode routing selection into TerraDraw's edit adapter. (a) is hours; (b) is days. Default to (a). |
| `2b5c` | Per-annotation dash styles | Decision: (a) split-layer workaround (N LineLayers filtered by strokeStyle), OR (b) wait for MapLibre support, OR (c) document as v1 limit. Default to (c) — already shipped style panel works for color/width/opacity, dash is degenerate case. |

**Size:** 1 session combined.

### Wave 6 — Phase 3 epic
| ID | Title | Notes |
|----|-------|-------|
| `baa4` | Unified annotations Phase 3 | **Fresh session, write a dedicated plan first.** Per `unified-annotations-path-backfill.md`: re-run path backfill audit query at start; UPDATE if non-zero. Then TerraDraw commit handler rewrite, features-table read-only flip, long-term migration of feature rows into annotations. 2+ sessions. |

**Size:** 2-3 sessions, requires its own plan doc.

---

## Bucket D — Strategic (separate cycle)

| ID | Title | Notes |
|----|-------|-------|
| `d40a` | OpenAPI spec + TypeScript SDK | Cycle 03 candidate. Requires Bucket A done first (no point publishing an SDK against an unhardened API). |

---

## Deferred (not in this cycle)

- `8e8e` F09 Measurement, `4b0d` F10 Annotations, `da4a` F11 Export, `1c79` F13 Sharing, `d2d6` F14 Embedding, `319b` N01 Cluster, `a38b` N02 Marker, `bb9f` N03 Data join. All blocked, all tagged `audit-2026-03-30`. These are flow-architecture epics; pick up in a discovery cycle, not a hardening cycle.

---

## Manifest

```manifest
plan: security-hardening-cycle-02
files:
  patch: apps/web/src/hooks.server.ts                                    # H1
  patch: apps/web/src/routes/api/v1/middleware.ts                        # H1, H2
  patch: apps/web/src/routes/api/v1/export/+server.ts                    # H3, H5
  patch: apps/web/src/routes/api/v1/export/progress/+server.ts           # H4
  patch: apps/web/src/routes/api/v1/export/[layerId]/+server.ts          # H7
  patch: apps/web/src/routes/api/v1/maps/[mapId]/annotations/+server.ts  # H5
  patch: apps/web/src/routes/api/v1/maps/[mapId]/comments/+server.ts     # H6
  create: apps/web/src/lib/server/db/migrations/0019_add_idempotency_keys_v2.sql  # H5 (or extend 0018)
  create: apps/web/e2e/api/security-h1-h2-auth.spec.ts                   # Wave 1
  create: apps/web/e2e/api/security-h3-h4-h7-export.spec.ts              # Wave 2
  create: apps/web/e2e/api/security-h5-h6-hygiene.spec.ts                # Wave 3
```

## Acceptance — cycle-level

- All 7 H-class seeds closed (`outcome:success`).
- 3 e2e specs pass; existing adversarial probes that surfaced H1-H7 now return their guarded codes (429/422/etc.).
- `docs/testing/adversarial-findings.md` annotated with "fixed in <commit>" per finding.
- Audit script (`bash ~/.claude/scripts/post-implementation-audit.sh apps/web/docs/plans/security-hardening-cycle-02.md`) returns N/N.

## Open questions

1. **Idempotency cache backing store.** Postgres table is simplest (already in stack); Redis is faster but adds a dependency surface. Default Postgres unless H5 perf surfaces problems.
2. **Per-user export queue cap (H3).** What's "too many"? 5 in-flight feels right but no data — start there, instrument, tune.
3. **M9 lockout (135c).** Real risk vs. attacker-DoS-by-lockout. Recommend: **defer to outcome:rework** after weighing — the IP-based rate limit already gives 90% of the protection.

---

## CORRECTED SCOPE — what's actually unblocked (post-2026-04-24 audit)

After closing 9 stale security seeds, the genuinely-open queue is small enough that a multi-wave plan is overkill. Three independent units of work, pickable in any order:

### Unit 1 — Anti-pattern policy decisions (6 seeds)
| ID | Anti-pattern | Findings | Likely action |
|----|--------------|----------|----------------|
| `0524` | fire-and-forget | 401 | Lint rule (project-wide) — false-positive heavy, decide policy first |
| `8bfc` | catch-all | 136 | Lint rule + audit each catch — likely some intentional |
| `3e35` | console-only-error | 11 | Replace with logger.error — small, mechanical |
| `a052` | untested-churn | 16 | Coverage report — informational, not necessarily fixable |
| `3f7f` | impact-scope | 2 | Read each — likely accept or refactor |
| `f645` | silent-catch | 1 | Read it, decide — single occurrence |

**Recommendation:** **`3e35` first** (mechanical, real bug). Then `f645` and `3f7f` (low-volume reads). Then policy session for the high-volume ones (`0524`, `8bfc`, `a052`) — those want a CLAUDE.md decision, not per-finding fixes.

### Unit 2 — Felt-parity tail (3 seeds)
| ID | Title | Approach |
|----|-------|----------|
| `c07b` | Drag-to-move architectural gap | Default: doc-only — update `docs/guides/maps-and-layers.md` to remove implied drag-to-move on imported features. Build (b) only if user signals it matters. |
| `2b5c` | Per-annotation dash limitation | Default: document as v1 limit in `unified-annotations.md` and the styling section of `felt-parity-annotations.md`. |
| `135c` | M9 account-level lockout decision | Default: close as `outcome:rework` with rationale "IP-based limiter sufficient; account lockout adds attacker-DoS surface" per the W1.D close-out reasoning. |

**Recommendation:** all three are doc/decision work. Batch into one short session.

### Unit 3 — Strategic (1 seed, 1 epic)
| ID | Title | Notes |
|----|-------|-------|
| `d40a` | OpenAPI spec + TypeScript SDK | Cycle 03. Real strategic surface — needs its own plan. Now genuinely unblocked since the API IS hardened. |
| `baa4` | Unified annotations Phase 3 | Fresh-session epic per HANDOFF. Write own plan first; re-run path backfill audit at start. |

**Recommendation:** `d40a` next strategic cycle. `baa4` whenever the user signals appetite for the dual-model collapse.

**Deferred (still blocked):** F09-F14, N01-N03 flow-audit tasks.
