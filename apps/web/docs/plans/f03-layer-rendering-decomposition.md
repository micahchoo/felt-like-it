# F03 — Layer Rendering Monolith Decomposition

> Plan for `felt-like-it-2b53` (F03). Recommended starting flow per `flow-architecture-program.md`. Decomposes the 887-line `MapCanvas.svelte` so F04 + 5 leaf flows (F13/F14/N01/N02/N03) become tractable.

## Thesis

`MapCanvas.svelte` is the single largest hot-flow file in the codebase (mulch `mx-bdbefd`: 11 hot-flow findings across 5 user flows). It mixes: source registration, layer paint specifications, hover/selection feature-state, click event routing, popup orchestration, viewport initialization, and TerraDraw integration. Every downstream flow that touches the map (sharing snapshots, embedding, clustering, custom markers, choropleth-from-join) has to spelunk this monolith first.

After F03:

- `MapCanvas.svelte` is a thin orchestrator (~150-200 LOC).
- Source/layer/paint/interaction concerns live in extractable, testable units.
- `svelte-maplibre-gl`'s declarative model is honored where v1.0.3 supports it (mulch `mx-e13901`, `mx-f92f9f`).
- Visual fidelity is preserved — characterization tests gate every refactor step.

Refactor, not rewrite. No new features. No paint changes. No event-handling changes. Only seam extraction.

## Pre-flight gates

1. **Characterization snapshot.** Take Playwright visual snapshots of the canvas in 5+ representative states:
   - Empty map.
   - Single layer with point features.
   - Single layer with polygon features + hover state active.
   - Multiple layers, one selected.
   - TerraDraw point-tool active mid-draw.

   These are the regression bar. Refactor steps that change snapshots without intent → revert.

2. **Mulch-aware reading.** Re-load relevant mulch records into the agent's prefix at refactor start:
   - `mx-bdbefd` (887-LOC monolith)
   - `mx-e13901` (declarative svelte-maplibre-gl)
   - `mx-f92f9f` (svelte-maplibre-gl v1.0.3 missing APIs)
   - `mx-9f2d7d` (`promoteId="id"` requirement)
   - `mx-edcd4e` (hover-aware paint)
   - `mx-3a57f5` (selection highlight)

3. **Branch.** Create `refactor/mapcanvas-decomposition`. Do not refactor on `master` — characterization snapshots may need iteration before the first extraction lands.

## Decomposition (5 sub-waves)

Each wave touches MapCanvas + creates 1-2 new files. Each wave ends with: (a) characterization snapshot tests pass, (b) the new file has its own unit tests where applicable, (c) MapCanvas LOC count drops by the predicted delta.

```
Pre-flight ──► A (Source registration)
                │
                ├─► B (Layer paint specs)
                │
                ├─► C (Feature-state hover/selection)
                │
                ├─► D (Click routing + popup orchestration)
                │
                └─► E (TerraDraw bridge)
```

A-E are **sequential**, not parallel. Each wave depends on MapCanvas being in a consistent state at the start.

### Wave A — Source registration extraction

**Goal.** Move source-element creation logic out of MapCanvas into a dedicated module.

**Files:**
- Create: `apps/web/src/lib/components/map/sources/LayerSourceRegistry.svelte` — accepts `layers: Layer[]`, renders the appropriate `<GeoJSONSource>` per layer with `promoteId="id"` (mulch mx-9f2d7d).
- Modify: `MapCanvas.svelte` — replace inline source declarations with `<LayerSourceRegistry layers={...} />`.

**Acceptance:** characterization snapshots match pre-A. MapCanvas LOC drops by ~80-120.

### Wave B — Layer paint specs extraction

**Goal.** Move paint-expression construction (CircleLayer/FillLayer/LineLayer paint props) into pure helpers.

**Files:**
- Create: `apps/web/src/lib/components/map/paint/layerPaint.ts` — pure functions returning paint specs for each geometry type. Accepts layer config + style overrides. Reuses the `coalesce` pattern from Annotation Renderer (mulch mx-edcd4e).
- Create: `apps/web/src/lib/components/map/paint/layerPaint.test.ts` — unit tests for each geometry-type paint output.
- Modify: `MapCanvas.svelte` — paint props come from `layerPaint(layer, style)` calls.

**Acceptance:** paint snapshots match pre-B. New unit tests cover all three geometry types + hover/selection variants.

### Wave C — Feature-state hover & selection

**Goal.** Move hover/selection feature-state mutation out of MapCanvas event handlers into a dedicated controller hook.

**Files:**
- Create: `apps/web/src/lib/components/map/useFeatureStateController.svelte.ts` — owns the hover-id + selection-id refs; mutates `map.setFeatureState` on change. Existing `useFeatureState`-shaped helpers in `lib/components/map/use*.svelte.ts` are the template.
- Modify: `MapCanvas.svelte` — instantiates the controller; reads from it for paint expressions; subscribes to map events to update it.

**Acceptance:** hover/select interactions match pre-C visually + behaviorally. Controller has unit tests covering hover-enter, hover-leave, select-while-hovering edge cases.

### Wave D — Click routing + popup orchestration

**Goal.** Untangle MapCanvas's `onclick` handler — currently dispatches to feature popups, annotation popups, drawing-tool commits, and selection state.

**Files:**
- Create: `apps/web/src/lib/components/map/useMapClickRouter.svelte.ts` — single-entry click handler that classifies the click (TerraDraw active? feature hit? annotation hit? empty?) and dispatches to the right downstream callback.
- Modify: `MapCanvas.svelte` — replaces inline click logic with router invocation.

**Acceptance:** all click flows still work (per existing e2e: feature popup, annotation popup, drawing tool, deselect-on-empty). Router has unit tests for each classification path.

### Wave E — TerraDraw bridge extraction

**Goal.** Move TerraDraw initialization + commit handler out of MapCanvas.

**Files:**
- Create: `apps/web/src/lib/components/map/TerraDrawBridge.svelte` — owns the TerraDraw instance, mode-switch wiring, commit handler. Currently scattered across MapCanvas and DrawingToolbar.
- Modify: `MapCanvas.svelte` — embeds `<TerraDrawBridge>` and forwards toolbar mode changes; the commit handler emits an event MapCanvas wires to whichever store the user picks (per Phase 3 baa4: annotation_objects vs features).

**Acceptance:** drawing flows match pre-E. Bridge is testable in isolation (mock TerraDraw instance).

## Success criteria

- `MapCanvas.svelte` is ≤200 LOC at the end (was 887).
- All Playwright visual snapshots match pre-refactor state (no regressions).
- Each new file has unit tests appropriate to its kind (.svelte.ts → vitest unit; .svelte → component snapshot).
- Mulch finding count for `MapCanvas.svelte` (currently 11) drops to ≤2.
- F04, F13, F14, N01-N03 are now unblocked at the source level (per the dependency graph in `flow-architecture-program.md`).

## Open questions

1. **Should TerraDraw bridge also handle the geometry-type → anchor-type mapping (Phase 3 baa4 dependency)?** Default: no — that's Phase 3's concern. Wave E only emits `(geometry, layerId)` events; the consumer decides what to write.
2. **Wave A: does `<LayerSourceRegistry>` need to handle source removal (when a layer is deleted)?** Almost certainly yes — verify the current MapCanvas behavior first.
3. **Are there any svelte-maplibre-gl v1.0.3 missing-feature workarounds (mulch mx-f92f9f) that the refactor exposes?** Likely yes — flag them as TODOs, do NOT add new workarounds in this refactor.

## Risks

- **Visual regression invisible to snapshots.** Snapshots can't catch every hover state / map-mode interaction. Mitigation: manual smoke-test the full draw-import-style-export loop before merging each wave.
- **Refactor scope creep.** The 11 mulch findings on MapCanvas tempt fixing-while-decomposing. Resist — F03 is decomposition only. Filed-but-unfixed findings stay tracked in mulch and become future seeds.
- **TerraDraw integration is fragile.** Wave E is the riskiest wave. Run it last; budget extra characterization for drawing flows.

## Out of scope

- Phase 3 unification (`baa4`) — independent program.
- F04 feature interaction — its own flow, separate plan after F03 completes.
- Anti-pattern fixes uncovered during decomposition — file new seeds, do not fix in-line.
