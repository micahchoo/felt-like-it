# Svelte Runes Audit

Skill source: `~/.claude/plugins/cache/svelte-skills-kit/svelte-skills/1.3.0/skills/svelte-runes/`
(SKILL.md + references/reactivity-patterns.md, common-mistakes.md, component-api.md, deep-dive.md, examples/)
Scope: `apps/web/src` — 102 `.svelte`, 19 `.svelte.ts`, 52 `$effect()` sites.
Method: read-only grep + targeted Read against the skill's specific rules.

Severity legend: **HIGH** = wrong reactive semantics or SSR-leak / loop hazard; **MED** = anti-pattern the skill explicitly rejects; **LOW** = stylistic / over-cautious code.

---

## Confirmed from prior audit

### HIGH-1 — module-scope `$state` singletons leak across SSR (5 sites)

Skill says: "Reactive state should be locally scoped per request" (deep-dive: state-referenced-locally / SSR caveat). Module-level `$state` shared across requests is universally identified as a leak risk in factory-pattern guidance.

Verified files (all top-level `let _x = $state(...)` re-exported via const object):
- `apps/web/src/lib/stores/map.svelte.ts:50–58` — `_center`, `_zoom`, `_bearing`, `_pitch`, `_basemapId`, `_interactionMode`, `_mapInstance`, `_viewportVersion`, `_mapContainerEl` (9 module singletons; export at `:60`).
- `apps/web/src/lib/stores/style.svelte.ts:4` — `_styleOverrides` (Map). Export `:8`.
- `apps/web/src/lib/stores/layers.svelte.ts:3–4` — `_layers`, `_activeLayerId`. Export `:6`.
- `apps/web/src/lib/stores/undo.svelte.ts:9–10` — `_past`, `_future`. Export `:12`.
- `apps/web/src/lib/utils/map-sources.svelte.ts:3` — `_hotFeatures`. Export `:5`.

Fix: convert each to `function createXStore() { let _x = $state(...); return {...} }`, hand to consumers via `setContext()` from `+layout.svelte`. The codebase already proves this works — `lib/stores/filters-store.svelte.ts` uses an instance class (`FiltersStore`), `viewport.svelte.ts` uses `createViewportStore(deps)`, `activity-store.svelte.ts` uses `class ActivityStore`, `export-store.svelte.ts` uses `createExportStore`. Five stragglers.

### HIGH-2 — `$effect` used as `$derived` (silent-overwrite anti-pattern)

Skill: "❌ Using $effect for derived state" (reactivity-patterns "Common Anti-Patterns"). Rule: when an effect's only job is to assign one state from another, replace with `$derived`.

- `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte:212–214` — `$effect(() => { outputName = defaultName; })` where `defaultName` is itself a `$derived` (line 211). Pure overwrite. **Caveat:** this pattern is sometimes justified to allow user override (typing into the input retains the value until `defaultName` changes again). The skill's "⚠️ Reassigning $derived (Svelte 5.25+)" anti-pattern note explicitly covers this — preferred alternative is `let outputName = $derived(defaultName)` and reassign on user input. **Fix:** make `outputName` a reassignable `$derived` and assign in the input handler. Severity: **MED** (functional, but skill rejects the form).

- `apps/web/src/lib/components/annotations/AnnotationForm.svelte:91–96` — `$effect(() => { if (pendingMeasurementData) { formType = 'text'; formText = pendingMeasurementData.content; } })`. Two-write side effect from a prop. Skill calls this exactly the pattern to avoid; safer is `$derived` + an `oncreate`-time pull, or guard via prop change ID. **MED** — same "user can edit, then prop changes overwrite" trap as GeoprocessingPanel.

- `apps/web/src/lib/screens/SettingsScreen.svelte:29–33` — `$effect(() => { if (status === 'success') nameValue = data.user.name; })`. Pure derive-from-prop with permanent overwrite. **MED**. Better: `let nameValue = $state(''); ` + load on mount + an explicit form reset, or `$derived` if there's no need for local edits. Currently any edit the user makes is silently wiped if `data.user.name` re-renders.

- `apps/web/src/lib/components/data/ExportDialog.svelte:19–21` — `$effect(() => { if (!selectedLayerId && layers[0]) selectedLayerId = layers[0].id; })`. Initialise-default-from-prop. Skill prefers `$effect.pre` (and `GeoprocessingPanel:87` already uses it correctly). **LOW-MED** — works, but `$effect.pre` is the documented form for "set default before DOM".

- `apps/web/src/lib/components/data/FilterPanel.svelte:38–43` — same pattern (`if (!newField && fields.length > 0) newField = fields[0]`). Same fix: `$effect.pre`. **LOW-MED**.

### MED-1 — no-op effect (dead code)

- `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:337–344` — `$effect(() => { if (scrollToFeatureId) { tick().then(() => { /* Scroll logic would go here if needed */ }); } })`. Body comment confirms it does nothing. Skill: effects must produce an observable side effect; otherwise delete. **Fix:** delete the effect. Reactivity will re-fire it forever for a no-op.

### LOW — `$effect` 348 (pendingMeasurementData) is a derive-and-cache

- `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:347–360` — sets `pendingMeasurementData` from `pendingMeasurement` prop. The local mirror exists only to feed `<AnnotationForm pendingMeasurementData={...} />`. This is effect-as-derived. **Fix:** `const pendingMeasurementData = $derived(pendingMeasurement ? {...} : null);`. Removes one mutation site and one re-render path.

---

## Refutation / refinement of prior list

- Prior listed `AnnotationStylePanel:22` as effect-as-derived. **Refuted (partial).** The effect at `AnnotationStylePanel.svelte:23–28` resets `pending` only when `annotation.id` changes (gated by `lastAnnotationId`). This is the documented "track-prop-id-and-reset-local-form" pattern; `$derived` would lose user edits. The pattern is correct; severity downgrade to **OK / acknowledged**. The author already wrote a comment explaining the reasoning.
- Prior listed `ExportDialog:19` as effect-as-derived. **Confirmed**, kept above as MED.
- Prior count of "3 effect-as-derived sites" understates the issue — there are at least 5 (added AnnotationPanel:347, FilterPanel:38).

---

## New findings the prior audit missed

### MED-2 — `$state` declared *after* a `$derived` that closes over it

mulch `mx-0dc46f` records the convention "declare `$state` before `$derived`". Verified violations:

- `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:154–164` — `selectedGroupFilter = $state(null)` at `:159`, but `filteredAnnotations = $derived(...selectedGroupFilter...)` is at `:163`. The author left a comment ("declared after state so order matches") — **clean**, false positive.
- However the *count effect* at `:112–125` reads `annotations` (declared `:95`) and `comments` (declared `:106`) — both `$derived` — fine. **Clean.**
- `apps/web/src/lib/components/annotations/AnnotationPanel.svelte:329–330` — `commentBody = $state('')` then `submittingComment = $derived(createComment.isPending)` — fine.
- I did not find a true violation of mulch `mx-0dc46f` in the source. **Convention is being followed.** Recommend adding an ESLint rule (e.g. `svelte/declaration-order`) to make it permanent.

### MED-3 — `$effect` writing to `$state` it also reads (no `untrack`) — ExportDialog

- `apps/web/src/lib/components/data/ExportDialog.svelte:19–21` — reads `selectedLayerId` AND writes it. Skill: "❌ Infinite loops in $effect" (reactivity-patterns) — fires only because the guard short-circuits, but the dependency graph is hostile. Either gate the read with `untrack`, or use `$effect.pre`. **MED.**

- Same shape: `apps/web/src/lib/components/data/FilterPanel.svelte:38–43` (reads `newField`, writes `newField`).

- `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte:93–98` (the colliding-layerB effect) reads `layerIdA`, `layerIdB`, writes `layerIdB`. Guarded by equality check; safe in practice but brittle. Add `untrack(() => { layerIdB = alt?.id ?? '' })` for symmetry with the rest of the codebase (which uses `untrack` consistently in MapCanvas/DrawingToolbar/useLayerDataManager).

### MED-4 — `$state.raw` not used where it should be

Skill: "Use `$state.raw()` for large, immutable data structures, or data you fully replace not mutate."

Codebase has **0 uses** of `$state.raw` / `$state.frozen` / `$state.snapshot` (verified via grep). Candidates the skill criteria match:

- `apps/web/src/lib/stores/map.svelte.ts:58` — `_mapInstance = $state<MapLibreMap | undefined>(undefined)`. The `MapLibreMap` instance is a huge non-plain object with private state. Wrapping it in a deep proxy is wasteful; consumers only ever read or replace, never mutate `mapInstance.x = y` reactively. **Fix:** `$state.raw<MapLibreMap | undefined>(undefined)`. Same applies to `_mapContainerEl` (DOM node).
- `apps/web/src/lib/stores/map-editor-state.svelte.ts` — `#interactionState`, `#selectedFeature` (full `GeoJSONFeature`). Selected feature is replaced wholesale, not mutated. Candidate for `$state.raw`.
- `apps/web/src/lib/components/map/MapCanvas.svelte:99` (in batch context) — `mapCenter = $state<maplibregl.LngLatLike>({...})`. The object is replaced wholesale (`mapCenter = { lng, lat }`) — never mutated. **Fix:** `$state.raw`.
- `apps/web/src/lib/components/data/FilterPanel.svelte` `availableFields` derivation iterates `features.slice(0, 100)` — features come from a query; replaced wholesale. Source array (wherever it lives) is a `$state.raw` candidate.

Severity **LOW** as correctness; **MED** as performance debt for the heatmap/pan/zoom hot path.

### MED-5 — `untrack` used consistently in some files, missing in equivalents

Files that use `untrack` for legitimate reasons (verified comments are correct):
- `MapCanvas.svelte:108`, `:127` — store ↔ local viewport sync (avoid feedback loop). Correct.
- `DrawingToolbar.svelte:79`, `:136` — reset/stop write to `_state` they shouldn't track. Correct.
- `useLayerDataManager.svelte.ts:105` — initLayers writes `layersStore`. Correct.
- `AnnotationPanel.svelte:116` — count change. Correct.

**Gap:** `apps/web/src/lib/components/map/useMeasurementTooltip.svelte.ts:13` — effect reads `result`, `map` and writes `tooltipPos`. Reading `currentResult` and writing `tooltipPos` is fine (no loop), but the effect at `:47` reads `measureActive` and calls `deps.getMeasurementStore().clear()` which mutates `currentResult` — that mutation will retrigger `:13`. There's an explicit guard (`if (!result || !map) tooltipPos = {x:50,y:50}; return;`) so it terminates, but the loop-of-2 is fragile. **MED:** wrap the mutation at `:47` in `untrack(() => deps.getMeasurementStore().clear())`.

### LOW-1 — `$bindable()` without sensible default

Skill (component-api): bindable defaults are required for parent-omits-binding case. Two-way usage rules: only when parent legitimately needs to write back.

- `apps/web/src/lib/components/data/ImportDialog.svelte:14` — `open = $bindable()` (no default). If a parent renders `<ImportDialog mapId={...} onimported={...} />` without `bind:open`, `open` is `undefined`, and `{#if open}` short-circuits — fine, but then internal `open = false` mutations write to nothing meaningful. **Fix:** `open = $bindable(false)` (and same for ExportDialog:16, ShareDialog:36, Modal:16).
- All four sites should default to `false` for safety; skill examples consistently show `$bindable(defaultValue)`.

### LOW-2 — composables use module-private `$state` legitimately, but document why

`apps/web/src/lib/components/map/use*.svelte.ts` files declare `let x = $state(...)` *inside* exported functions. These are **per-call** instances (function scope), not module scope — each component invocation creates a fresh closure. **Clean, no action**, but worth a one-line code comment per file to forestall future audits.

### LOW-3 — `$state.snapshot` never used

Codebase serialises state via `JSON.stringify`/`structuredClone` patterns (none found in the targeted grep, so likely fine). Skill: when persisting / logging state, use `$state.snapshot()` to strip the proxy. Recommend audit of any localStorage persistence (`saveViewportLocally`, `editor-layout` persistence) — if those hand a `$state` object directly to `JSON.stringify`, it works but logs the proxy in error paths. Out of scope for this audit pass; flag for follow-up.

---

## Effect inventory — the 52 sites

Quick triage of every `$effect()` callsite:

| File:line | Status |
|---|---|
| ShareViewerScreen:31 | OK — wires hash sync, returns cleanup |
| SettingsScreen:29 | **MED** — derive-from-prop overwrite |
| AnnotationForm:91 | **MED** — derive-from-prop overwrite |
| AnnotationPanel:112 | OK — count change, properly `untrack`ed |
| AnnotationPanel:337 | **MED** — no-op |
| AnnotationPanel:348 | **LOW** — should be `$derived` |
| AnnotationStylePanel:23 | OK — id-gated form reset (skill-compliant pattern) |
| ImportDialog:229 | OK — cleanup-only effect (returns destroy fn) |
| ExportDialog:19 | **MED** — initialise default; should be `$effect.pre` |
| FilterPanel:38 | **MED** — initialise default; should be `$effect.pre` |
| GeoprocessingPanel:93 | OK-ish — guarded same-layer write; add `untrack` for symmetry |
| GeoprocessingPanel:212 | **MED** — silent overwrite of `outputName` |
| UpdateBanner:5 / Toast:51 / OfflineBanner:4 / InstallPrompt:6 | OK — DOM-side / timer effects with cleanup |
| ConfirmDialog:27 / Modal:22 | OK — focus management, returns cleanup |
| SearchInput:19 | OK — debounce with cleanup |
| useMeasurementTooltip:13 | OK |
| useMeasurementTooltip:47 | **MED** — mutation should be `untrack`ed |
| DrawingToolbar:69, :252, :293 | OK — properly `untrack`ed; comments document why |
| useCursorStatus:8 | OK — listener with cleanup |
| ShareDialog:77 | OK — load on open |
| useLayerDataManager:105 | OK — `untrack`ed init |
| useViewportSave (all) | OK — listener + cleanup |
| MapCanvas effects | OK — heavily annotated, `untrack`ed |
| MapEditor effects (8 sites) | Not audited individually — flagged for follow-up |

---

## Caveat: MapEditor.svelte not deeply audited

`MapEditor.svelte` has 8 `$effect()` sites (`:107, :155, :165, :173, :178, :183, :237, :250, :331`) controlling dialog open state, layer data plumbing, and editor lifecycle. The grep view shows `importDialogOpen`/`exportDialogOpen`/`shareDialogOpen` are `$state(false)` sync'd to `editorLayout.activeDialog` via effects — this is exactly the bidirectional-mirror pattern the skill warns about (state in two places). Recommended follow-up: replace local `*DialogOpen` state with `$derived(editorLayout.activeDialog === 'X')` and remove the sync effects.

---

## Summary table

| ID | Severity | File:line | Issue |
|---|---|---|---|
| H-1 | HIGH | 5 stores | module-scope `$state` SSR leak |
| H-2a | MED | GeoprocessingPanel:212 | $effect-as-$derived; user-edit-loss |
| H-2b | MED | AnnotationForm:91 | $effect-as-$derived |
| H-2c | MED | SettingsScreen:29 | $effect-as-$derived |
| H-2d | MED | ExportDialog:19 | should be $effect.pre |
| H-2e | MED | FilterPanel:38 | should be $effect.pre |
| M-1 | MED | AnnotationPanel:337 | no-op effect, delete |
| L-1 | LOW | AnnotationPanel:348 | should be $derived |
| M-3 | MED | useMeasurementTooltip:47 | mutation w/o untrack — fragile |
| M-4 | MED | map.svelte.ts:58, MapCanvas, MapEditorState | $state.raw not used for non-reactive carriers |
| M-5 | MED | MapEditor.svelte (8 effects) | dialog state mirror — replace with $derived |
| L-1 | LOW | ImportDialog:14, ExportDialog:16, ShareDialog:36, Modal:16 | $bindable() no default |

Total: **1 HIGH (5 sites)**, **8 MED**, **2 LOW**.
Prior audit was directionally correct for the "Big 5 SSR leak" finding and the silent-overwrite cluster; refined: prior count of 3 silent-overwrites should be 5; AnnotationStylePanel was a false positive (well-justified pattern); MapEditor.svelte and `$state.raw` opportunities were missed.
