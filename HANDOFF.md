# Handoff

## Goal

Resume from prior session's HANDOFF (`d390c23`), then user-driven workflow: triage queue → compose plan from ready seeds → execute plan. Mid-session pivot when "execute" surfaced extensive stale-seed pipeline.

User's literal asks (verbatim, in order):
- "1" (start the proposed Wave 1 — security hardening from a stale seed)
- "do it" (continue to next anti-pattern)
- "do it" (continue to anti-pattern triage)
- "do it" (felt-parity tail batch)
- "compose these into a plan" (the post-triage ready queue)
- "start" (the security plan)
- "do these: a052 untested-churn — coverage push, baa4 Phase 3 — fresh-session epic"
- "finish these: baa4 Phase 3 pre-flight finished, F-flow program scope"
- "compose the tasks from both plans into waves and execute"
- "yes" (Gates 2 + 3 for baa4 Wave A)

## Progress

### Closed seeds (27 total this session)

- ✅ **Anti-patterns (3):** `f645` silent-catch, `3e35` console-only-error, `3f7f` impact-scope, `a052` untested-churn — see commit reasons.
- ✅ **Felt-parity tail (5):** `06b2` name+description, `2e48` groups, `41c9` bidir convert, `5179` styling, `e92e` post-sweep gaps, `c07b` drag-to-move (doc), `2b5c` dash limit (doc), `135c` M9 lockout (accepted-risk), `f8e0` path backfill (audit), `ea94` annotation-groups e2e, `6115` annotation-convert e2e.
- ✅ **Security stale (9):** `a721` H1, `a9ad` H2, `4971` H3, `f6b0` H4, `aec9` H5, `2b9b` H6, `b5dc` H7, `5102` MEDIUM batch, `05dd` LOW batch.
- ✅ **F-flow stale (11):** `864d` F02, `2b53` F03, `aab0` F04, `ebc0` F05, `946c` F06, `565b` F07, `ccff` F08, `2eaa` F12, `8e8e` F09, `4b0d` F10, `da4a` F11.
- ✅ **Strategic (1):** `d40a` OpenAPI/SDK closed without plan per user direction.

### Real code shipped this session

- 🔼 `apps/web/e2e/api/annotation-groups.spec.ts` — 21 tests (commit `8beb033`)
- 🔼 `apps/web/e2e/api/annotation-convert.spec.ts` — 14 tests (commit `8beb033`)
- 🔼 `apps/web/src/routes/+layout.svelte:24-46` — toast on uncaught browser errors + comment justifying error-reporter silent-catch (commit `c0a1847`)
- 🔼 `docs/guides/maps-and-layers.md:53` — drag-to-move scoped to drawn features only (commit `e57c825`)
- 🔼 `apps/web/docs/plans/felt-parity-annotations.md:392+` — dash limitation note in Task 3.3 (commit `e57c825`)

### Planning artifacts

**Canonical plan files (read these first next session):**
- 🔼 **`apps/web/docs/plans/unified-annotations-phase-3.md`** — active program A. Wave A scope revised in commit `70a6b07` to 4 sub-tasks (was wrongly sized as "1 line"). Pre-flight: gates 1+3 done; gate 2 (product confirmation) given verbally this session but no execution started.
- 🔼 **`apps/web/docs/plans/flow-architecture-program.md`** — active program B. Roadmap interleaving Phase 3 + 5 sharing/rendering leaves over ~10 sessions.
- 🔼 **`apps/web/docs/plans/notes/unified-annotations-path-backfill.md`** — pre-flight gate 1 evidence + audit SQL.
- 📛 **`apps/web/docs/plans/security-hardening-cycle-02.md`** — OBSOLETE. Useful only as a postmortem of the first stale-seed discovery; bucket A is entirely shipped, scope corrected at the bottom of the file.

### DB snapshot (gate 3 for baa4 Wave A)

- `/tmp/felt-like-it-snapshots/baa4-wave-a-pre-1777066712.dump` — pg_dump data-only of `annotation_objects` + `features` + `layers` (765 KB). Kept for use when Wave A.1 begins.

## What Worked

- **Verify-before-act on every seed.** After the first stale-seed discovery (security cycle), I made `git log -S '<symbol>' -- <path>` the standard first step before claiming a seed. Caught 3 more stale-cycle batches.
- **Bulk-close with commit-ref evidence.** Each closed-stale-seed reason cites the specific commit that shipped the work. Future audits can reverse-engineer the actual close-loop without re-doing the investigation.
- **OBSOLETE banner pattern over deletion** for plans with commits-to-mark-as-postmortem (security-hardening-cycle-02.md). Preserves history + reasoning trail.
- **Plain `delete` for plans without external readers** (f03-layer-rendering-decomposition.md was written same session, removed same session).
- **Pre-flight DB queries done in psql first**, plan revised against the real schema findings (Wave C discriminator audit revealed only `mixed`/`polygon` layer.types — neither distinguished user-drew from imported).

## What Didn't Work

- **Composing plans from seed bodies without code verification** — 2 plans (security-hardening-cycle-02.md + f03-layer-rendering-decomposition.md) authored and immediately marked obsolete because the underlying work was already shipped. Same lesson 4 times in one session.
- **Sizing baa4 Wave A as "1 line in MapCanvas"** — actual handler is in `DrawingToolbar.svelte:99-244`, with hotOverlay + undoStore + onfeaturedrawn callback chain + drawing-save.test.ts characterization. Re-decomposed into 4 sub-tasks in commit `70a6b07`.
- **Anti-pattern detector signal quality is poor.** 91% false-positive rate on `a052` untested-churn (ignores e2e + extracted-store patterns). `impact-scope` finding is JSON-only, lost in text reports. `console-only-error` 1/11 real, 10/11 false-positive. The detector needs allowlist enrichment for `**/debug/**`, error-reporter side-channels, util functions returning user-facing strings.

## Key Decisions

- **baa4 Wave C eliminated.** Discriminator audit showed no clean structural way to identify user-drew vs imported features in existing 10K rows (only `layer.type IN (mixed, polygon)`; no `created_via` property; one giant 10K seed batch). Going with Option 3 from the original plan: skip migration, treat existing rows as imports, only NEW TerraDraw commits go to annotation_objects.
- **`135c` M9 closed as accepted-risk.** IP-based limiter is sufficient at current scale; account-lockout adds attacker-DoS surface.
- **`d40a` OpenAPI/SDK closed without plan.** Per explicit user direction; re-issue when external API consumers materialize.
- **`5179`/`2b5c` MapLibre dash documented as v1 limit.** No `line-dasharray` data-driven support upstream; color/width/opacity per-annotation already shipped covers the common Felt-parity ask.

## Trajectory

**How we got here.** Started by resuming the 22/22 audit handoff (`d390c23`). Spec-shipped `ea94` + `6115`, closing the last two felt-parity audit gaps. Pivoted to /triage when user invoked it; discovered 22 needs-triage items in project queue. Composed a security plan from the H1-H7 seeds — and on first execution attempt, discovered all 7 were already shipped in commits I hadn't read yet. Recovery + bulk-close. Re-composed the queue as the actual remaining work (anti-patterns + felt-parity tail + Phase 3 epic). Wrote 3 fresh plans (Phase 3, F03, flow-architecture-program). On execution attempt for Phase 3 Wave A — discovered F03 (the prereq) was also shipped, plus 10 of its blocker chain. 4th stale-seed discovery; bulk-close + revise. Took the DB snapshot, started Wave A — discovered the persistence-flip is 4 sub-tasks, not 1 line. Stopped before the multi-file refactor.

**Hard calls.** (1) After the first stale discovery, the natural temptation was to bulk-discard all the security seeds without citing commits — I instead spent 5 minutes per seed grepping git log to attach commit refs. The reason: a future audit needs to verify "was this actually done" without re-doing the investigation. (2) Stopping mid-Wave-A when the scope blew up. The user had explicitly OK'd gates 2+3 ("yes"); I could have justified bashing through. Per CLAUDE.md "Never attempt multi-file refactors in a single response" + the actual blast radius (drawing-save.test.ts breaks, parent's onfeaturedrawn chain breaks, hotOverlay vs query-cache optimism mismatch) — pushing through would have shipped a half-converted state. Wrote the corrected 4-sub-task decomposition + stopped.

**Shaky ground.** baa4 Wave A.4 (`onfeaturedrawn` callback fate) is the highest-uncertainty edge — I haven't traced what the parent does with it. Pre-work for next session called out in the plan. Also: the corrected anti-pattern findings (1 real / 10 false-positive on `3e35`) were judged from reading file contexts; I didn't write a follow-up seed to enrich the detector. Worth one if anyone runs into noise again.

**Invisible context.** The user has been in a 6-month build cycle on this product and has been (correctly) treating the seeds queue as a stale artifact. Multiple "do this" responses were the user pushing me to do real code work, but I kept finding stale signals. The 27-seed close was actually the highest-value work this session — clearing the false backlog so the genuinely-open queue (Phase 3 + 5 sharing/rendering leaves) is visible.

## Active Skills & Routing

- **check-handoff** at session start (resumed `d390c23`).
- **mulch + seeds** throughout — 4 mulch records added, 27 seeds closed, 1 mulch sync committed.
- **/triage** mid-session (project queue cleared from 22 needs-triage to 0).
- **/handoff** at session close (this file).
- Next session likely wants: **writing-plans** if starting Wave A.1; **executing-plans** with subagent mode for the 4-sub-task Wave A; **shadow-walk** if picking up F13 Sharing instead.

## Infrastructure Delta

No infrastructure changes this session. No plugin updates, no hooks added, no new skills, no CI changes. Only seeds + mulch + plans + 1 fix + 2 e2e specs.

## Knowledge State

- Indexed: nothing added via `context add` this session.
- Productive tiers: default `ml search` + `git log -S` + `grep -rn` routing was sufficient. Foxhound not invoked this session.
- Gaps: anti-pattern detector script (`~/.claude/scripts/anti-pattern-scan.sh`) emits `impact-scope` to JSON only, not the text report. Recovery: re-run with JSON capture if anyone wants to act on impact-scope findings.

## Next Steps

Priority order (per `flow-architecture-program.md` recommended interleave):

1. **baa4 Wave A.1** (~half-day): in `DrawingToolbar.svelte`, ADD `saveAsAnnotation(f)` parallel to existing `saveFeature(f)`. Wire `createAnnotationMutation` (helper at `AnnotationMutations.ts:46-101`) + anchor derivation per geometry type. Don't touch the dispatch yet. Add vitest section mirroring `drawing-save.test.ts` shape. **Pre-work: trace `onfeaturedrawn` in MapEditor.svelte first** — that's the highest-uncertainty edge of A.4.
2. **F13 Sharing** (`1c79`, ~1-2 sessions, alternative to Wave A.1): hash-state viewport URL (`#zoom/lat/lng`), dedupe token resolution, lightweight read-only viewer. Independent of Phase 3 — won't conflict.
3. After A.1 + verify: **baa4 Wave A.2** (flip dispatch), then A.3 (test updates), then A.4 (callback decision). Each its own commit.
4. After Wave A complete: **F14 Embedding** (alternates with B for attention diversity).
5. baa4 Wave B → D → E (3 more sessions in Program A).
6. N01 Cluster, N02 Marker, N03 Data join (Program B leaves).
7. baa4 Wave F (90-day deferred cleanup).

⚠ unverified: I did not trace `onfeaturedrawn` consumers in MapEditor.svelte — Wave A.4 default ("remove the callback, rely on cache invalidation") may break a parent flow I haven't seen.

## Context Files

- **`apps/web/docs/plans/unified-annotations-phase-3.md`** — the canonical Phase 3 plan (read FIRST). Wave A scope revised in `70a6b07`.
- **`apps/web/docs/plans/flow-architecture-program.md`** — the canonical roadmap interleaving Phase 3 + 5 sharing/rendering leaves.
- **`apps/web/docs/plans/notes/unified-annotations-path-backfill.md`** — pre-flight gate 1 audit + SQL templates.
- **`apps/web/src/lib/components/map/DrawingToolbar.svelte:99-244`** — TerraDraw commit handler + saveFeature; the file Wave A.1 will modify.
- **`apps/web/src/lib/components/annotations/AnnotationMutations.ts:46-101`** — `createAnnotationMutationOptions` helper to wire from Wave A.1.
- **`HANDOFF-expertise.md`** — structured mulch records for sveltekit/maplibre/testing/drizzle + session deltas (mulch v0.6.3 ml prime + ml diff). Generate at session start: `ml prime --domain unified-annotations`.
- `/tmp/felt-like-it-snapshots/baa4-wave-a-pre-1777066712.dump` — pg_dump pre-Wave-A snapshot, kept for restoration if Wave A.1+ goes wrong.
