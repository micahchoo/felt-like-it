# Handoff

## Goal
Enhance/flesh out/simplify FLI's feature sets and E2E flows using `svelte-maplibre` and `allmaps` repos (at `/mnt/Ghar/2TA/DevStuff/Patterning/Maps/`) as reference patterns.

## Progress
- ✅ Full 16-flow E2E audit against both reference repos — 64 findings
- ✅ Reframed as 20 flow-level problems (16 existing + 4 new flows)
- ✅ 20 seeds issues created, all labeled `flow` + `audit-2026-03-30`
- ✅ 8 mulch records captured (conventions, decisions, failure)
- ✅ F01 bug fix: `DashboardScreen.svelte:30` — `handleCreate` infinite recursion fixed
- ✅ Design spec written and approved
- 🔄 Wave 1 plan (F03 + F04) — started writing-plans, discovered critical API constraint, needs plan written
- ⬚ Waves 2-7 not started

## What Worked
- Parallel audit agents (4 agents x 4 flows) — completed full audit in ~5 minutes
- context-mode `ctx_batch_execute` for exploring both reference repos without flooding context
- Flow-level problem framing made the audit findings actionable instead of a laundry list

## What Didn't Work
- **Assumed API parity between `svelte-maplibre` (reference) and `svelte-maplibre-gl` (FLI's dep)**. They are different libraries. `svelte-maplibre-gl` v1.0.3 does NOT have: `manageHoverState`, `eventsIfTopMost`, `hoverCursor`, `beforeLayerType`, nested popup-in-layer, `cluster` prop, `MarkerLayer`, `JoinedData`, `ZoomRange`. The entire S1/S2/S3/S4 simplification strategy assumed these existed.
- This means Wave 1 must implement hover/interaction primitives manually using `FeatureState` component + `onmouseenter`/`onmouseleave` handlers, not simply "add props".

## Key Decisions
- **Approach C**: Audit-first, then flow-driven execution. Each wave is a sandwich: simplify → enhance → feature → simplify.
- **E2E flow framing**: Every task is trigger → path → outcome. No orphan component work.
- **Reference-driven**: Changes cite specific patterns from svelte-maplibre or Allmaps.
- **Wave ordering**: Layer rendering (foundation) → Interaction → Panels → Data → Content → Features → Sharing → Collaboration
- **MapCanvas decomposition target**: DataLayers + AnnotationLayers + MeasurementLayers + InteractionManager as children inside `<MapLibre>`
- **Lightweight viewer for share/embed**: Instead of full MapEditor in readonly mode

## Active Skills & Routing
- `brainstorming` — completed (design approved)
- `writing-plans` — **next step**: write Wave 1 implementation plan accounting for svelte-maplibre-gl API constraints
- `executing-plans` — will execute the plan once written

## Infrastructure Delta
No infrastructure changes this session.

## Knowledge State
- **Indexed**: Both reference repos explored via context-mode (not `context add`). `svelte-maplibre-gl` API surface verified from installed package.
- **Productive tiers**: Default foxhound routing not used this session — manual exploration was primary.
- **Gaps**: `svelte-maplibre-gl` has minimal docs. Its `FeatureState` component needs investigation — it's exported but not documented. The `MapLayerEventProps` type (from `layers/common.d.ts`) defines what event handlers layers accept — next agent should read this file.

## Next Steps
1. **Read `svelte-maplibre-gl` internals** — especially `layers/common.js` (MapLayerEventProps), `sources/FeatureState.svelte`, and a layer implementation like `CircleLayer.svelte` to understand what interaction primitives are actually available
2. **Write Wave 1 plan** using `writing-plans` skill — F03 (MapCanvas decomposition) + F04 (feature interaction) accounting for the real API surface
3. **Execute Wave 1** using `executing-plans` — claim seeds `felt-like-it-2b53` (F03) and `felt-like-it-aab0` (F04)
4. **Continue through Waves 2-7** per the design spec

## Context Files
- `docs/superpowers/specs/2026-03-30-reference-driven-enhancement-design.md` — design spec with wave ordering
- `docs/research/e2e-flow-problems.md` — 20 flow problems (canonical reference for all seeds)
- `docs/research/e2e-flow-audit.md` — detailed findings for flows 1-4 (Wave 1 targets)
- `apps/web/src/lib/components/map/MapCanvas.svelte` — 887-line target for decomposition (F03)
- `apps/web/src/lib/stores/map-editor-state.svelte.ts` — interaction state machine (F04)
- `node_modules/.pnpm/svelte-maplibre-gl@1.0.3_.../node_modules/svelte-maplibre-gl/dist/` — actual API surface
