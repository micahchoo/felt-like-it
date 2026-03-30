# Map Editor Cluster — Contracts

> Zoom level 6: every promise the map-editor subsystem makes to itself and its neighbours.
> Cross-ref: [components](components.md) | [behavior](behavior.md)
>
> **Re-scanned 2026-03-29** after MapEditorState consolidation.
> Previous version documented 3 separate stores + useInteractionBridge. This version reflects the unified class.

---

## 1. MapEditorState — The Single Contract Point

### What Changed

The previous contract surface comprised:
- `selectionStore` (module-level singleton) — selection, activeTool, popup
- `interactionModes` (module-level singleton) — InteractionState FSM, `transitionTo()`
- `drawingStore` (module-level singleton) — Terra Draw lifecycle
- `useInteractionBridge` (composable) — 5 `$effect` blocks bridging the above

All four are **deleted**. A single `MapEditorState` class now owns all interaction, selection, and drawing state. It is distributed via Svelte context (`setContext`/`getContext`), not module-level singletons.

### Public Interface

```typescript
class MapEditorState {
  // ── Reactive getters ──────────────────────────────────────────────
  get interactionState(): InteractionState;   // discriminated union FSM
  get selectedFeature(): GeoJSONFeature | null;
  get selectedFeatureIds(): Set<string>;
  get activeTool(): DrawTool;                 // 'point'|'line'|'polygon'|'select'|null
  get popupCoords(): { lng: number; lat: number } | null;
  get selectedLayerId(): string | null;
  get hasSelection(): boolean;
  get drawingStatus(): 'idle' | 'importing' | 'ready' | 'stopped';
  get isDrawingReady(): boolean;
  get drawingInstance(): TerraDraw | null;

  // ── Atomic mutation methods ───────────────────────────────────────
  // Each updates ALL affected state synchronously — no $effect chains.
  transitionTo(next: InteractionState): void;     // FSM + tool sync
  selectFeature(feature, coords?, layerId?): void; // selection + FSM transition
  clearSelection(): void;                          // selection + FSM (featureSelected→idle)
  setActiveTool(tool: DrawTool): void;             // tool + clear selection if draw tool + FSM
  toggleFeatureId(id: string): void;               // multi-select toggle

  // ── Context-driven reactions ──────────────────────────────────────
  handleSectionChange(section: string | null): void;  // replaces ME:sectionCleanup
  handleDesignModeChange(designMode: boolean): void;  // replaces ME:designModeCleanup

  // ── Drawing lifecycle ─────────────────────────────────────────────
  initDrawing(map: MapLibreMap): Promise<TerraDraw | null>;  // generation-guarded
  stopDrawing(): void;
  reset(): void;  // full teardown — test isolation + unmount
}

// Context wiring
function setMapEditorState(): MapEditorState;  // called by MapEditor (provider)
function getMapEditorState(): MapEditorState;  // called by children (consumers)
```

### InteractionState — Discriminated Union

```typescript
type InteractionState =
  | { type: 'idle' }
  | { type: 'featureSelected'; feature: SelectedFeature }
  | { type: 'drawRegion'; geometry?: Polygon }
  | { type: 'pickFeature'; picked?: PickedFeatureRef }
  | { type: 'pendingMeasurement'; anchor: MeasurementAnchor; content: MeasurementContent };
```

All types are exported from `map-editor-state.svelte.ts`. Narrowing via `state.type` provides full type safety.

### Key Architectural Properties

1. **Atomic mutations**: `selectFeature()` updates 6 fields + FSM transition in one synchronous call. No intermediate reactive states observable.
2. **No $effect bridges**: The 5 bridge effects from `useInteractionBridge` are inlined into mutation methods. `handleSectionChange()` and `handleDesignModeChange()` are called explicitly by MapEditor's 2 remaining bridge effects.
3. **Context-scoped, not global**: `setContext()`/`getContext()` scoping means multiple MapEditor instances would each get isolated state. Previous module singletons were app-global.
4. **Generation-guarded async**: `initDrawing()` uses `#drawingGeneration` counter to abort stale imports, same pattern as the old `drawingStore`.

---

## 2. Consumer Read/Write Matrix

### Provider

| Component | Role | Wiring |
|-----------|------|--------|
| **MapEditor** | Provider | `setMapEditorState()` — creates instance, sets in Svelte context |

### Consumers

| Consumer | File | Reads | Writes | Boundary |
|----------|------|-------|--------|----------|
| **MapEditor** | `components/map/MapEditor.svelte` | `interactionState`, `selectedFeature`, `selectedLayerId`, `activeTool`, `hasSelection`, `isDrawingReady`, `drawingInstance` | `transitionTo()`, `selectFeature()`, `clearSelection()`, `setActiveTool()`, `handleSectionChange()`, `handleDesignModeChange()`, `initDrawing()`, `stopDrawing()` | Provider — reads + writes all facets |
| **MapCanvas** | `components/map/MapCanvas.svelte` | `selectedFeature`, `popupCoords`, `activeTool` | `selectFeature()`, `clearSelection()` | Internal child — selection + popup |
| **DrawingToolbar** | `components/map/DrawingToolbar.svelte` | `activeTool`, `isDrawingReady`, `drawingInstance`, `drawingStatus` | `setActiveTool()`, `initDrawing()`, `stopDrawing()` | Internal child — drawing lifecycle |
| **DataTable** | `components/data/DataTable.svelte` | `selectedFeatureIds` | `toggleFeatureId()`, `selectFeature()` | **Cross-boundary** — data panel reading map-editor state |
| **useKeyboardShortcuts** | `components/map/useKeyboardShortcuts.svelte.ts` | (via deps interface) `interactionState` | (via deps interface) `transitionTo()`, `setActiveTool()` | Internal composable — injected deps, not direct import |

### God-Component Assessment

MapEditor still reads/writes all facets, but this is **structural** — it is the context provider and orchestrator. The key improvement: it no longer writes to 3 separate stores + a bridge; it writes to one object with atomic methods. The "god component" smell is replaced by a "controller" pattern.

**Remaining leaks** (MapEditor writes that conceptually belong elsewhere):
- `setActiveTool()` via keyboard shortcuts — mitigated by `useKeyboardShortcuts` composable extraction
- `clearSelection()` on design mode toggle — correctly lives in MapEditor as orchestrator
- `handleSectionChange()` / `handleDesignModeChange()` — explicitly owned by MapEditor (sidebar state lives here)

---

## 3. Remaining Store Contracts (Unchanged)

These stores were NOT consolidated into MapEditorState. They remain module-level singletons:

| Store | File | Public API | Reads from MapEditorState? |
|-------|------|-----------|--------------------------|
| **mapStore** | `stores/map.svelte.ts` | `center`, `zoom`, `bearing`, `pitch`, `basemapId`, `basemapUrl`, `interactionMode`, `mapInstance`, `mapContainerEl`, `viewportVersion`; `setViewport()`, `loadViewport()`, `setMapInstance()`, `setMapContainerEl()`, `setBasemap()`, `setInteractionMode()`, `saveViewportLocally()`, `loadViewportLocally()`, `getViewportSnapshot()` | No |
| **layersStore** | `stores/layers.svelte.ts` | `all`, `active`, `activeLayerId`; `set()`, `add()`, `update()`, `remove()`, `toggle()`, `setActive()`, `updateStyle()`, `reorder()`, `getOrderedIds()`, `getOrderedIdsWithVersions()` | No |
| **filterStore** | `stores/filters.svelte.ts` | `get()`, `add()`, `remove()`, `clear()`, `hasFilters()`, `applyToFeatures()`, `toMapLibreFilter()`, `fslFiltersToMapLibre()`; `saveFilters()`, `loadFilters()` | No |
| **styleStore** | `stores/style.svelte.ts` | `showLegend`, `editingLayerId`; `getStyle()`, `setStyle()`, `clearStyle()`, `toggleLegend()`, `setEditingLayer()` | No |
| **undoStore** | `stores/undo.svelte.ts` | `canUndo`, `canRedo`, `undoLabel`, `redoLabel`; `push()`, `undo()`, `redo()`, `clear()` | **Runtime only**: closures capture MapEditorState refs at `push()` time |

### Utility Stores

| Store | File | Role | Reads |
|-------|------|------|-------|
| **viewport** | `stores/viewport.svelte.ts` | Viewport-based feature pagination for DataTable | Injected deps: `fetchFn`, `getActiveLayer`, `isLargeLayer`, `getMap` |
| **annotation-geo** | `stores/annotation-geo.svelte.ts` | `AnnotationObject[]` → GeoJSON FeatureCollections | None (factory arg) |
| **hotOverlay** | `utils/map-sources.svelte.ts` | In-memory `Feature[]` per layer for live drawing preview | None |

---

## 4. Knot Analysis — Boundary Crossings

### Subsystem Boundary Definition

```
INSIDE map-editor subsystem:
  apps/web/src/lib/stores/map-editor-state.svelte.ts
  apps/web/src/lib/components/map/MapEditor.svelte
  apps/web/src/lib/components/map/MapCanvas.svelte
  apps/web/src/lib/components/map/DrawingToolbar.svelte
  apps/web/src/lib/components/map/useKeyboardShortcuts.svelte.ts

OUTSIDE (neighbours):
  apps/web/src/lib/components/data/DataTable.svelte
  apps/web/src/lib/stores/map.svelte.ts (mapStore)
  apps/web/src/lib/stores/layers.svelte.ts (layersStore)
  apps/web/src/lib/stores/filters.svelte.ts (filterStore)
  apps/web/src/lib/stores/style.svelte.ts (styleStore)
  apps/web/src/lib/stores/undo.svelte.ts (undoStore)
  apps/web/src/lib/stores/viewport.svelte.ts (viewportStore)
  apps/web/src/lib/utils/map-sources.svelte.ts (hotOverlay)
```

### Crossing Count

| # | Crossing | Direction | Type | Era | Separability |
|---|----------|-----------|------|-----|-------------|
| 1 | DataTable → MapEditorState | inbound read | `getMapEditorState()` → `selectedFeatureIds`, `toggleFeatureId()`, `selectFeature()` | 2024+ | **Medium** — could pass via props but context is cleaner for deep nesting |
| 2 | MapEditor → mapStore | outbound read/write | Module import — viewport, basemap, mapInstance | 2024+ | **Low** — fundamental dependency, mapStore is infrastructure |
| 3 | MapEditor → layersStore | outbound read/write | Module import — layer CRUD, active layer | 2024+ | **Low** — fundamental dependency |
| 4 | MapEditor → filterStore | outbound read/write | Module import — filter state | 2024+ | **Low** — fundamental dependency |
| 5 | MapEditor → styleStore | outbound read | Module import — editingLayerId | 2024+ | **High** — only reads one field |
| 6 | MapEditor → undoStore | outbound read/write | Module import — undo/redo, push commands | 2024+ | **Medium** — commands capture refs at push time |
| 7 | MapEditor → hotOverlay | outbound write | Module import — clearHotFeatures on unmount | 2024+ | **High** — single cleanup call |
| 8 | MapCanvas → mapStore | outbound read/write | Module import — viewport sync | 2024+ | **Low** — fundamental dependency |
| 9 | MapCanvas → layersStore | outbound read | Module import — layer rendering | 2024+ | **Low** — fundamental dependency |
| 10 | MapCanvas → filterStore | outbound read | Module import — filter expressions | 2024+ | **Low** — fundamental dependency |
| 11 | DrawingToolbar → hotOverlay | outbound write | Module import — addHotFeature/removeHotFeature | 2024+ | **Medium** — drawing preview overlay |
| 12 | DrawingToolbar → undoStore | outbound write | Module import — push undo commands | 2024+ | **Medium** — undo integration |
| 13 | useKeyboardShortcuts → MapEditorState | inbound (type-only) | Type import only — deps injected at call site | 2024+ | **High** — already dependency-injected |

### Crossing Summary

| Metric | Value |
|--------|-------|
| Total crossings | 13 |
| Inbound (outside → map-editor state) | 2 (DataTable, useKeyboardShortcuts type-only) |
| Outbound (map-editor → outside stores) | 11 |
| Era distance | Uniform 2024+ — no era-weighted penalties |
| Highly separable | 3 (#5, #7, #13) |
| Infrastructure (non-separable) | 6 (#2, #3, #4, #8, #9, #10) |

### vs Previous Version

| Metric | Before (3 stores + bridge) | After (MapEditorState) |
|--------|---------------------------|----------------------|
| Internal store-to-store deps | 1 (interactionModes → selectionStore via $effect) | **0** — unified class |
| Bridge effects | 5 ($effect blocks in useInteractionBridge) | **0** — inlined into atomic methods |
| Module-level singletons for interaction | 3 (selection, interaction, drawing) | **0** — context-scoped class |
| MapEditor $effect blocks for interaction | 5 (section cleanup, design mode, selection→feature, tool dismiss, feature pick) | **2** (section change, design mode change) |
| Boundary crossings (external) | ~15 (each consumer imported each store separately) | **13** (all via one `getMapEditorState()` import) |

### Security Pins

| Pin | Location | Assessment |
|-----|----------|------------|
| **Feature ID resolution** | `MapEditorState.selectFeature()` calls `resolveFeatureId()` | `resolveFeatureId` handles missing/numeric/string IDs. No user-controlled string interpolation into queries. Feature IDs flow from MapLibre click events (trusted source) to tRPC mutations (parameterized). **No injection vector.** |
| **Terra Draw instance access** | `MapEditorState.drawingInstance` getter | Returns the raw TerraDraw instance. Consumers (DrawingToolbar) call `setMode()`, `getSnapshot()`, `removeFeatures()`. These are sandboxed to the canvas — no server interaction. **No escalation risk.** |
| **Context isolation** | `setContext(Symbol())` | Symbol key prevents external context hijacking. Only code that calls `getContext()` within the same component tree can access the state. **Adequate isolation.** |
| **queueMicrotask in MapCanvas** | `handleFeatureClick` defers `selectFeature()` | Timing-based: click data captured synchronously, state write deferred by one microtask. Feature + coords are captured in closure — no TOCTOU window for data mutation. **Safe.** |

---

## 5. tRPC Mutation/Query Boundaries

### Cache Unification (New)

The previous version documented a **cache invalidation gap**: DrawingToolbar invalidated TanStack cache keys, but MapEditor's `loadLayerData()` fetched directly via `trpc.features.list.query()`.

This is now **resolved**. MapEditor's `loadLayerData()` fetches via `fetchQuery()` through the TanStack Query cache. The comment at MapEditor.svelte:212-216 documents the pattern:

```
// loadLayerData now fetches via the TanStack Query cache (fetchQuery).
// DrawingToolbar's onSuccess already invalidated the cache entry, so
// fetchQuery will see it as stale and re-fetch fresh data from the server.
// No explicit invalidateQueries needed here — cache invalidation is the
// coordination mechanism.
```

**Cache strategy is now unified**: all feature data flows through TanStack Query. DrawingToolbar's mutation `onSuccess` invalidates `queryKeys.features.list({ layerId })`, and MapEditor's `loadLayerData` observes that invalidation via `fetchQuery`.

### Queries (Read)

| Call | Component | Cache Strategy |
|------|-----------|---------------|
| `trpc.annotations.list.query({ mapId })` | MapEditor | TanStack `createQuery` — auto-refresh on invalidation |
| `trpc.features.list` (via `fetchQuery`) | MapEditor (layerDataManager) | **TanStack fetchQuery** — unified with DrawingToolbar invalidation |
| `trpc.features.listPaged.query(params)` | MapEditor (viewportStore) | Debounced fetch via viewportStore |
| `trpc.layers.list.query({ mapId })` | MapEditor | Manual → `layersStore.set()` |

### Mutations (Write) — Map-Editor Boundary Only

| Call | Component | Invalidation |
|------|-----------|-------------|
| `trpc.features.upsert.mutate(...)` | DrawingToolbar | `queryClient.invalidateQueries(queryKeys.features.list({ layerId }))` |
| `trpc.features.delete.mutate(...)` | DrawingToolbar | `queryClient.invalidateQueries(queryKeys.features.list({ layerId }))` |
| `trpc.maps.update.mutate(...)` | MapEditor | None (viewport is local-first) |
| `trpc.events.log.mutate(...)` | MapEditor | None (best-effort telemetry) |

---

## 6. Terra Draw Contract

### Lifecycle (now in MapEditorState)

```
idle ──initDrawing(map)──> importing ──await imports──> ready ──stopDrawing()──> stopped
  ^                           |                           |
  |                           | (gen !== #drawingGeneration)
  |                           v                           |
  |                        [aborted, returns null]        |
  +──────────────────reset()──────────────────────────────+
```

**Owner change**: Terra Draw lifecycle moved from standalone `drawingStore` into `MapEditorState.initDrawing()` / `.stopDrawing()` / `.reset()`. The generation counter pattern is preserved.

### Who Manages What

| Aspect | Owner | Notes |
|--------|-------|-------|
| Instance creation | `MapEditorState.initDrawing()` | Called by DrawingToolbar `$effect` |
| Mode registration | `MapEditorState.initDrawing()` | Point, LineString, Polygon, Select modes |
| Mode switching | DrawingToolbar | `editorState.drawingInstance.setMode(mode)` |
| Feature capture | DrawingToolbar | `draw.on('finish', id => ...)` |
| Feature snapshot | DrawingToolbar | `draw.getSnapshotFeature(id)` |
| Feature removal | DrawingToolbar | `draw.removeFeatures([id])` |
| start/stop | `MapEditorState` | `.initDrawing()` calls `draw.start()`, `.stopDrawing()` calls `draw.stop()` |
| Re-init on basemap swap | DrawingToolbar | `map.on('style.load', ...)` |

---

## 7. MapLibre Contract

Unchanged from previous scan. Three access patterns:

1. **Declarative** (svelte-maplibre-gl components in MapCanvas template)
2. **Store-mediated** (viewport sync via `viewportVersion` cycle breaker)
3. **Direct API** (escape hatches: `getSource().setData()`, event listeners)

### Race Condition Surface

| # | Risk | Status |
|---|------|--------|
| 1 | Viewport sync cycle | MITIGATED — `viewportVersion` counter |
| 2 | Layer data push (dual-write via `getSource().setData()`) | PARTIAL — still present in MapEditor |
| 3 | Terra Draw re-init on basemap swap | MITIGATED — generation counter |
| 4 | Feature click during effect flush | MITIGATED — `queueMicrotask()` deferral |
| 5 | Multiple `moveend` listeners | No conflict — read-only |

---

## 8. Effect Block Inventory (Post-Consolidation)

### MapEditor (~10 $effect blocks, down from 14)

| Tag | Deps | Writes to | Purpose |
|-----|------|-----------|---------|
| ME:mapContainerEl | `mapAreaEl` | `mapStore.setMapContainerEl()` | Sync DOM ref |
| ME:loadFilters | `mapId` | `loadFilters()` | One-shot filter restore |
| ME:saveFilters | `layersStore.all`, `filterStore.get()` | `saveFilters()` | Persist filters |
| ME:viewportPersist | `mapStore.mapInstance` | localStorage via moveend | Persist viewport |
| ME:measureActive | `activeSection`, `analysisTab`, `designMode` | `measureResult` | Clear measurement |
| ME:sectionChange | `activeSection` | `editorState.handleSectionChange()` | **Replaced 5 bridge effects** |
| ME:designModeChange | `designMode` | `editorState.handleDesignModeChange()` | **Replaced 5 bridge effects** |
| ME:initLayers | `initialLayers` | `layersStore.set()`, `loadLayerData()` | Bootstrap |
| ME:viewportLoading | `mapStore.mapInstance`, `layersStore.active` | viewportStore | Viewport pagination |
| ME:statusBar | `mapStore.mapInstance` | cursor/zoom local state | Status bar |

**Eliminated**: ME:selectionToFeature, ME:toolDismissFeature, ME:featurePickCapture, ME:designModeCleanup, ME:sectionCleanup — all inlined into MapEditorState atomic methods.

### MapCanvas (4 $effect blocks — unchanged)

| Tag | Deps | Writes to | Purpose |
|-----|------|-----------|---------|
| MC:syncMapInstance | `mapInstance` | `mapStore.setMapInstance()` | Push map ref |
| MC:storeToLocal | `mapStore.viewportVersion` | local viewport vars | Programmatic viewport |
| MC:localToStore | `mapCenter`, `mapZoom` | `mapStore.setViewport()` | User pan/zoom |
| MC:firstLabelLayer | `mapInstance` | `firstLabelLayerId` | Basemap label discovery |

### DrawingToolbar (3 $effect blocks — unchanged count, updated deps)

| Tag | Deps | Writes to | Purpose |
|-----|------|-----------|---------|
| DT:initTerraDraw | `map` prop | `editorState.initDrawing()` | Terra Draw lifecycle |
| DT:syncToolToTerraDraw | `editorState.activeTool`, `editorState.isDrawingReady` | `drawingInstance.setMode()` | Sync app tool to Terra Draw |
| (cleanup) | `map` prop | `editorState.stopDrawing()` | Cleanup on unmount |

---

## 9. Props Contracts at Decomposition Seams

### Seam: KeyboardShortcuts (Extracted)

```typescript
interface KeyboardShortcutsDeps {
  getEffectiveReadonly: () => boolean;
  getDesignMode: () => boolean;
  getInteractionState: () => InteractionState;
  transitionTo: (next: InteractionState) => void;
  undoStore: { undo: () => void; redo: () => void; };
  selectionStore: { setActiveTool: (tool: DrawTool) => void; };
  toggleDesignMode: () => void;
}
// Returns: (e: KeyboardEvent) => void
// Note: `selectionStore` in deps name is a vestigial label —
// MapEditor passes `editorState` as both `selectionStore` and
// supplies `transitionTo` from `editorState.transitionTo`.
```

### Seam: StatusBar (Not Yet Extracted)

Same as previous scan — `cursorLat`, `cursorLng`, `currentZoom` from MapLibre events.

### Seam: DialogVisibility (Not Yet Extracted)

Same as previous scan — 3 boolean `$state` vars + toggle functions.

### Seam: ViewportServerSave (Not Yet Extracted)

Same as previous scan — `mapId`, viewport snapshot, basemap, tRPC mutation.

---

## Interface Explicitness Assessment

| Interface | Explicit (typed)? | Notes |
|-----------|-------------------|-------|
| MapEditorState class | **Yes** — fully typed with TypeScript | All getters typed, method signatures enforce parameter types, InteractionState is a discriminated union |
| Context wiring (`set`/`getMapEditorState`) | **Yes** — typed Symbol key, typed return | Compile-time safety for consumers |
| useKeyboardShortcuts deps | **Yes** — `KeyboardShortcutsDeps` interface | Dependency injection with typed contract |
| MapCanvas → MapEditorState | **Implicit (convention)** — calls `getMapEditorState()` directly | No interface — depends on full class. Could be narrowed to a read-only subset. |
| DrawingToolbar → MapEditorState | **Implicit (convention)** — calls `getMapEditorState()` directly | Same — depends on full class |
| DataTable → MapEditorState | **Implicit (convention)** — calls `getMapEditorState()` directly, **cross-boundary** | This is the highest-risk implicit crossing |
| Terra Draw ↔ App | **Implicit (runtime)** — `draw.on('finish')`, `draw.setMode()` | Third-party API, not typed beyond terra-draw's own types |
| MapLibre escape hatches | **Implicit (runtime)** — `map.getSource().setData()` | Cast-heavy, runtime errors on missing source |

**Recommendation**: Define narrow read-only interfaces (e.g., `MapEditorSelectionReader`) for cross-boundary consumers like DataTable, reducing coupling surface.

---

**See also:** [components](components.md) | [behavior](behavior.md)
