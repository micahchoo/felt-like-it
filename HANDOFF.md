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
- ✅ F03: MapCanvas decomposed 887→369 LOC — `DataLayerRenderer` + `AnnotationRenderer` extracted (commits `3bcd14a`, `0a527ee`, `e5f406c`)
- ✅ F04: Feature-state selection highlight, event-identity click dedup, cache decoupled from `selectedFeature` (commit `1b5e40b`)
- ✅ F05: Optimistic draw UI (no visual gap), DrawActionRow auto-dismiss removed (commit `876796e`)
- ✅ F06: oninput/onchange split eliminates per-tick paint rebuilds, Revert button added (commit `260177f`)
- ⬚ F07: Filtering — split-brain, ephemeral, incomplete (`felt-like-it-565b`)
- ⬚ F08: Geoprocessing — black box with no preview (`felt-like-it-ccff`)
- ⬚ F12: Panel navigation — three systems fighting (`felt-like-it-2eaa`, High)
- ⬚ F02: Data import — blind upload, dangerous buffering (`felt-like-it-864d`)
- ⬚ N01/N02/N03: Cluster, rich marker, data join new flows

## What Worked
- DAG-following: F03→F04→F05→F06 in dependency order, each building on the last
- Wave-based extraction: DataLayerRenderer + AnnotationRenderer in parallel agents, then integrate
- Feature-state over paint-manipulation: `getHoverAwarePaint(layer, type, highlightColor)` bakes both hover and selected into static expressions — cache never references selection state
- `oninput`/`onchange` split for continuous inputs: local pending state for preview, one `layersStore` flush per drag gesture

## What Didn't Work
- **`bash ~/.claude/scripts/sd-next.sh` crashes** with `jq: Cannot index boolean with string "labels"` — `sd ready --json` seems to return something unexpected. Use `sd ready` (non-JSON) instead for next task selection.
- **`svelte-maplibre-gl` v1.0.3 API mismatch**: Does NOT have `manageHoverState`, `eventsIfTopMost`, `hoverCursor`, `beforeLayerType`, nested popup-in-layer. All interaction primitives must be implemented manually.

## Key Decisions
- **Feature-state for both hover and selected**: `getHoverAwarePaint()` now handles both. Cache computes once per layer-style change, not per selection change.
- **Event-identity click dedup**: `e.originalEvent === _lastClickEvent` replaces 300ms timestamp hack. Overlapping layers share the same DOM event.
- **Optimistic hotOverlay with temp ID**: `temp-${Date.now()}` added before mutateAsync, swapped with real ID on success, removed on error.
- **DrawActionRow stays until user acts**: Removed 8s auto-dismiss — user drives dismiss.
- **`oninput` → local state only, `onchange` → flush stores**: Prevents layerRenderCache recompute on every slider tick.

## Active Skills & Routing
- `executing-plans` — was active for Wave 1 (F03/F04). Plan at `docs/superpowers/plans/2026-03-30-wave1-mapcanvas-decomposition.md` is fully executed.
- Next task (F07, F08, or F12) should use `shadow-walk` to trace the filtering/panel flows before editing.

## Infrastructure Delta
No infrastructure changes this session.

## Knowledge State
- **Indexed**: Neither reference repo was `context add`'d — explored via context-mode sandbox only.
- **Productive tiers**: Default foxhound routing not used this session — direct file reads were primary.
- **Gaps**: `svelte-maplibre-gl` v1.0.3 has minimal docs. Layer event props (`MapLayerEventProps`) in `layers/common.d.ts`. `FeatureState` component is exported and works — `id`, `source`, `state` props confirmed working.

## Next Steps
1. **Pick next from DAG** — `sd ready` shows: F07 (filtering split-brain), F08 (geoprocessing), F12 (panel nav High), N01/N02/N03 new flows. F12 is highest priority but needs new EditorLayout store — use `brainstorming` skill first.
2. **F07 (felt-like-it-565b)** — Filtering split-brain: `filterStore` ephemeral state vs layer DB state. Find filter UI components and trace the split.
3. **F12 (felt-like-it-2eaa)** — High priority. Three panel systems (activePanelIcon, activeSection, showDataTable+dialogs). Needs brainstorming before coding — unified EditorLayout store + URL-reflected state.
4. **Fix `sd-next.sh`** — jq fails when `sd ready --json` output contains non-object items. Until fixed, use `sd ready` (plain text) for task selection.

## Context Files
- `docs/superpowers/specs/2026-03-30-reference-driven-enhancement-design.md` — design spec with wave ordering
- `docs/research/e2e-flow-audit-consolidated.md` — all 20 flow problems with severity ratings
- `apps/web/src/lib/components/map/DataLayerRenderer.svelte` — 184 LOC, extracted from MapCanvas
- `apps/web/src/lib/components/map/MapCanvas.svelte` — 369 LOC (was 887), now delegates to child renderers
- `apps/web/src/lib/components/map/map-styles.ts` — `getHoverAwarePaint(layer, type, highlightColor?)` — both hover+selected in one call
