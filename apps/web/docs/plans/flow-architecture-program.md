# Flow Architecture Program — F01-F16 + N01-N03

> **Scoping document, not an executable plan.** Maps the dependency graph for the `audit-2026-03-30` flow audit (8 ready seeds + their blockers). Recommends a starting flow but defers per-flow plan-writing until that flow is picked up.

## Why this exists

The 8 "ready" F/N flow seeds (F09, F10, F11, F13, F14, N01, N02, N03) are all blocked by upstream flows. Two distinct blocker clusters surface from the dependency graph:

**Cluster 1 — Foundational user flows (blocks F09 Measurement, F10 Annotations, F11 Export):**

- `865d` F02 Data import — blind upload, dangerous buffering
- `ebc0` F05 Drawing — feature vanishes, aggressive auto-dismiss
- `946c` F06 Style editing — expensive rebuilds, no safety net
- `565b` F07 Filtering — split-brain, ephemeral, incomplete
- `ccff` F08 Geoprocessing — black box with no preview
- `2eaa` F12 Panel navigation — three systems fighting

**Cluster 2 — Map plumbing (blocks F13 Sharing, F14 Embedding, N01-N03 Cluster/Marker/Join):**

- `2b53` F03 Layer rendering — monolith blocks all map work
- `aab0` F04 Feature interaction — silent map, no feedback loop

The user-listed "ready" 8 seeds are the leaves; the 8 blockers are the roots.

## Dependency graph (compressed)

```
[F02 Import]      ──┐
[F05 Drawing]     ──┤
[F06 Style edit]  ──┼──► [F09 Measurement]
[F07 Filter]      ──┼──► [F10 Annotations]
[F08 Geoproc]     ──┼──► [F11 Export]
[F12 Panel-nav]   ──┘

[F03 Layer render] ──┬──► [F13 Sharing]
                     ├──► [F14 Embedding]
[F04 Feat interact] ─┼──► [N01 Cluster]
                     ├──► [N02 Marker]
                     └──► [N03 Data join]
```

The two clusters share no blockers. They CAN proceed independently in parallel cycles, IF the user wants two parallel programs of work. Realistically, pick one cluster per cycle.

## What each cluster represents

**Cluster 1 (foundations):** Shaping how the user *creates and manipulates* map content (drawing, importing, filtering, processing, editing). The leaves (F09/F10/F11) are downstream views of the same content (measurement is "analyze drawn geometry," annotations is "comment on drawn geometry," export is "ship drawn geometry"). Fixing the leaves before the foundations means re-doing them when the foundations change.

**Cluster 2 (plumbing):** Shaping how the *map itself* renders and responds. F03 is the "MapCanvas monolith blocks all map work" item — per session-start mulch (mx-bdbefd) it's an 887-line monolith with 11 hot-flow findings. Until F03 is decomposed, anything that touches map rendering (sharing snapshots, embedding cooperative-gestures, clustering, custom markers, choropleth-from-join) is building on a bad seam.

## Recommended starting flow

**F03 Layer rendering (`2b53`)** — the MapCanvas monolith decomposition.

Why first:
- Highest blast radius unblocked by going first: clears the runway for F04 + 5 N/F leaves.
- Already has structural priors: mulch records mx-bdbefd (887-line monolith, 11 hot-flow findings) + mx-e13901 (FLI uses svelte-maplibre-gl declaratively but ignores its interaction model) + mx-9f2d7d (promoteId="id" required for FeatureState) + mx-edcd4e (hover-aware paint).
- Per CLAUDE.md craft discipline: pick the load-bearing intervention. F03 is structural; downstream F-tasks become tractable once it's split.
- Doesn't depend on Phase 3 unification (`baa4`) — they touch different files. Can run as a parallel program.

Risk: refactoring an 887-line monolith without breaking visual fidelity. Mitigation: characterization-testing first (snapshot tests of rendered output for representative datasets), then incremental extraction with each step verified.

## What this program does NOT do

- It does NOT close any of the 17 flow seeds. Each remains open with its blocker chain.
- It does NOT pre-decide architecture for any flow — those are per-flow plans, written when the flow is picked up (same pattern as `unified-annotations-phase-3.md`).
- It does NOT estimate timelines. Each F-flow is its own ~1-3 session unit; a cluster is 6-9 sessions; both clusters complete is a multi-month effort.

## How to pick this up

1. **Confirm the starting choice.** F03 is recommended; user may prefer a leaf-first approach (e.g., F11 Export — it has only one blocker, F08 Geoproc, which is somewhat isolated).
2. **Write a dedicated plan** for the chosen flow (template: `unified-annotations-phase-3.md`). Include flow context, files to touch, characterization tests if it's a refactor, acceptance criteria.
3. **Claim the flow seed and its immediate blockers.** Do not bypass blockers — the blocker exists because the leaf depends on its outputs.
4. **Per-flow execution.** Most F-flows are 1-3 sessions. After completion, re-run the audit script (`bash ~/.claude/scripts/post-implementation-audit.sh ...`) and close the seed.

## Out of scope

- Real-time collaboration (`felt-like-it-660a`).
- Phase 3 unified-annotations (`baa4`) — independent program with its own plan.
- Anti-pattern policy decisions (`0524`, `8bfc`) — independent.
- OpenAPI/SDK (`d40a`) — closed without plan this cycle.
