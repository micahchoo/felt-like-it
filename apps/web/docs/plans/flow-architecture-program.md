# Flow Architecture Program — Remaining Work (post-audit 2026-04-24)

> **Re-scoped after seed audit.** The original `audit-2026-03-30` cycle had 16 flow seeds; 11 of them were already shipped but never closed. This doc reflects the actual remaining 5 + the unification program.

## What's actually open

After bulk-closing 11 stale seeds (commit `d7421a2`), only the **rendering & sharing** sub-cluster of the flow audit remains:

| Seed | Title | Approach |
|------|-------|----------|
| `1c79` F13 | Sharing — no viewport context, heavy viewer | Hash-based viewport state (`#zoom/lat/lng`); deduplicate token resolution; lightweight read-only viewer (split bundle); link expiration. |
| `d2d6` F14 | Embedding — scroll-jacks, ships bloat | Cooperative gestures; single `generateEmbedSnippet()`; code-split or dedicated embed component; configurable `frame-ancestors`. |
| `319b` N01 | Cluster exploration | svelte-maplibre GeoJSON cluster + CircleLayer for clusters + expansion-on-click (>1000-feature datasets). |
| `a38b` N02 | Rich marker | svelte-maplibre MarkerLayer with Svelte snippet children; HTML markers, hover, popup. |
| `bb9f` N03 | Data join | Polygon layer + CSV upload; key matching UI; preview joined attributes; choropleth update; DataTable shows merged columns. |

All five are now **truly unblocked** at the code level (F03 layer rendering shipped `e5f406c`; F04 feature interaction shipped `1b5e40b`). Their seed graph still shows `Blocked by: 2b53, aab0` because the seed dependency edges weren't pruned when the blockers closed — fixable with `sd update` if seeds support graph mutation.

## Coherent execution roadmap

Two parallel programs of value, each shippable independently:

### Program A — Unified annotations (baa4)

The `unified-annotations.md` Phases 1+2 shipped. Phase 3 collapses the dual model. Per-wave detail in `unified-annotations-phase-3.md`. Status:

- ✅ **Pre-flight gate 1** (path-anchor backfill audit) — 0 candidates.
- ❓ **Pre-flight gate 2** (product confirmation) — user signal needed: "Phases 1+2 hold up in real use."
- ❓ **Pre-flight gate 3** (DB snapshot) — user-only.
- ➡ **Wave A** — TerraDraw commit → annotation_objects (1 session, single-line write-path flip).
- ➡ **Wave B** — features-table application-write lock-down (1 session, grep + ESLint rule).
- ⛔ **Wave C** — DELETED per discriminator audit (no clean migration path; existing 10K rows stay as imports).
- ➡ **Wave D** — DataTable repurposes to read annotations grouped by layer (1 session).
- ➡ **Wave E** — `/api/features` 90-day Sunset deprecation headers (1-2 hours).
- ➡ **Wave F** — Cleanup after 90-day window (1 session).

**Total active execution:** 4 sessions + 1 cleanup-after-90-days. Modest.

### Program B — Sharing & rendering leaves (F13/F14/N01/N02/N03)

Each is its own ~1-2 session work item. No internal dependencies between them (post-F03/F04 ship). Recommend order:

1. **F13 Sharing** (`1c79`) — lowest risk, highest UX value. Hash-state viewport + dedupe token resolution. Heavy-viewer split is a follow-up (could pair with F14).
2. **F14 Embedding** (`d2d6`) — cooperative-gestures + bundle-split. Pairs naturally with F13 (both produce read-only viewers).
3. **N01 Cluster** (`319b`) — straightforward svelte-maplibre integration; valuable for any user with >1000 features.
4. **N02 Rich marker** (`a38b`) — same, MarkerLayer integration.
5. **N03 Data join** (`bb9f`) — most product surface (key-matching UI + choropleth update + DataTable merge). Save for last; benefits from being able to draw on N01/N02 patterns.

**Total:** 5-7 sessions across the program, each independent.

## Suggested interleave

Both programs proceed in parallel cycles. A reasonable ordering of the next ~10 sessions:

1. **(decision)** baa4 product-confirmation + DB snapshot — user-only, blocks Wave A.
2. baa4 Wave A — TerraDraw commit flip.
3. F13 Sharing.
4. baa4 Wave B — features write lock-down.
5. F14 Embedding.
6. baa4 Wave D — DataTable repurpose.
7. baa4 Wave E — Sunset headers.
8. N01 Cluster.
9. N02 Rich marker.
10. N03 Data join.
… 90 days later …
11. baa4 Wave F — drop `/api/features`.

Interleave preserves attention diversity — refactor sessions and feature sessions alternate. Either program can stall without blocking the other.

## What this program does NOT do

- Doesn't close `1c79` `d2d6` `319b` `a38b` `bb9f` — those need real implementation work.
- Doesn't pre-decide architecture for F13-N03 — each gets its own dedicated plan when picked up (template: `unified-annotations-phase-3.md`).
- Doesn't auto-execute baa4 Wave A — gates 2 and 3 are user-only.

## Out of scope

- Anti-pattern policy decisions (`0524 fire-and-forget`, `8bfc catch-all`) — defer to a focused lint-policy session.
- Real-time collaboration (`660a`) — explicitly blocked.
- OpenAPI/SDK (`d40a`) — closed without plan this cycle.

## Process meta

This document was rewritten 2026-04-24 after discovering 11 of the 16 flow-audit seeds were stale (work shipped, seeds never closed). Same pattern surfaced for the security cycle (9 stale seeds) and 5 felt-parity items earlier in the same session — total **25 stale seeds closed in one cycle.** The seed pipeline needs a "verify-against-current-code" gate before issuing detection-driven seeds; otherwise future agents waste effort scoping plans against fictional backlogs.
