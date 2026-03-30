# Map Editor Cluster — Components & Modules

> **Last re-scan:** 2026-03-29 (uncommitted working tree)
> **Previous scan:** pre-consolidation (3-store + bridge architecture)

## What Changed

Three stores (`drawing.svelte.ts`, `selection.svelte.ts`, `interaction-modes.svelte.ts`) and one bridge composable (`useInteractionBridge.svelte.ts`) were **deleted** and replaced by a single `MapEditorState` class. This eliminates the 5-effect bridge that synchronized separate stores and replaces it with atomic methods that update all affected state in one synchronous call.

**Deleted files:**
- `stores/drawing.svelte.ts` → `MapEditorState.initDrawing()`, `stopDrawing()`, `reset()`
- `stores/selection.svelte.ts` → `MapEditorState.selectFeature()`, `clearSelection()`, `setActiveTool()`
- `stores/interaction-modes.svelte.ts` → `MapEditorState.transitionTo()`, `interactionState`
- `components/map/useInteractionBridge.svelte.ts` → `MapEditorState.handleSectionChange()`, `handleDesignModeChange()`

**New file:** `stores/map-editor-state.svelte.ts` (~250 LOC)

## Component Tree

```
MapEditor (orchestrator, ~500 LOC)
├── MapCanvas (~700 LOC)
│   ├── DrawingToolbar (~300 LOC)
│   │   └── DrawActionRow (~50 LOC)
│   ├── FeaturePopup
│   ├── AnnotationContent (in-map popup)
│   └── DeckGLOverlay (97 LOC, heatmap)
├── LayerPanel (~200 LOC)
├── BasemapPicker (72 LOC)
├── SidePanel
│   ├── DataTable, FilterPanel, StylePanel, Legend
│   ├── ActivityFeed (230 LOC)
│   ├── MeasurementPanel, GeoprocessingPanel
│   └── AnnotationPanel (~1200 LOC)
├── ImportDialog, ExportDialog
└── ShareDialog
```

**Key pattern:** MapEditor creates `MapEditorState` via `setMapEditorState()` (Svelte 5 context). Children retrieve it via `getMapEditorState()`. No prop drilling for interaction/selection/drawing state.

## State Architecture

### MapEditorState (consolidated class)

Single class using Svelte 5 `$state` runes with private fields and public getters:

```
MapEditorState
├── Interaction: #interactionState (discriminated union)
│   States: idle | featureSelected | drawRegion | pickFeature | pendingMeasurement
├── Selection: #selectedFeature, #selectedFeatureIds, #activeTool, #popupCoords, #selectedLayerId
├── Drawing: #drawingState (idle | importing | ready | stopped), #drawingGeneration
└── Atomic methods (no effect chains needed):
    ├── transitionTo(next)      — updates interaction + tool in one call
    ├── selectFeature(f, coords, layerId) — updates selection + interaction + tool
    ├── clearSelection()        — resets selection + interaction to idle
    ├── setActiveTool(tool)     — updates tool only
    ├── toggleFeatureId(id)     — multi-select toggle
    ├── handleSectionChange(s)  — cleans stale modes when sidebar changes
    ├── handleDesignModeChange(d) — resets to idle on design mode entry
    ├── initDrawing(map)        — generation-guarded async Terra Draw init
    ├── stopDrawing()           — safe teardown
    └── reset()                 — full state reset (test isolation + teardown)
```

**Context delivery:** `setMapEditorState()` / `getMapEditorState()` via `Symbol('MapEditorState')`.

### Remaining stores (unchanged)

**Core rendering ring:**
- `mapStore` — MapLibre instance + viewport + `_viewportVersion` race guard
- `layersStore` — reactive Layer array, activeLayerId, visibility map
- `filterStore` — per-layer UIFilter[], persisted to localStorage, `fslFiltersToMapLibre`
- `styleStore` — per-layer LayerStyle overrides, editingLayerId, showLegend

**Utility:**
- `undoStore` — Command stack (past/future, MAX_HISTORY=50)
- `viewport.svelte.ts` — factory for paginating features by map bounds (DataTable use)
- `annotation-geo.svelte.ts` — annotation geometry store

**Files in `stores/` directory:** annotation-geo, filters, layers, **map-editor-state**, map, style, undo, viewport (8 files, down from 10).

## Internal Dependency Graph

```
MapEditor ──setMapEditorState()──► MapEditorState (context)
    │                                    ▲    ▲    ▲
    │                                    │    │    │
    ├── MapCanvas ──getMapEditorState()──┘    │    │
    │   └── DrawingToolbar ──getMapEditorState()──┘
    │                                         │
    └── useKeyboardShortcuts (dep injection)──┘
                                    (types only from map-editor-state)
```

**Data flow pattern:**
- MapEditor: creates context, wires section/design-mode `$effect` → `editorState.handleSectionChange/handleDesignModeChange`
- MapCanvas: reads `editorState.selectedFeature`, `activeTool`, `interactionState`; writes via `editorState.selectFeature()` (deferred via `queueMicrotask`)
- DrawingToolbar: reads `editorState.isDrawingReady`, `drawingInstance`, `activeTool`; calls `editorState.initDrawing()`, `setActiveTool()`
- useKeyboardShortcuts: receives `MapEditorState` methods via dependency injection interface

## Key Modules

### MapEditor.svelte
| Function | Responsibility |
|----------|---------------|
| `setMapEditorState()` | Creates + provides MapEditorState via Svelte 5 context |
| `isLargeLayer(layer)` | Gates tile vs GeoJSON path (>10K features + Martin) |
| `logActivity(action, metadata)` | Fire-and-forget events.log + bump activityRefreshTrigger |
| `fetchViewportFeatures` (effect) | Per-layer features.list → source.setData() |
| `$effect` section/design | Routes section/design-mode changes to MapEditorState |

### MapCanvas.svelte
| Function | Responsibility |
|----------|---------------|
| `MC:syncMapInstance` | Push MapLibre instance to mapStore |
| `MC:storeToLocal` | Viewport version → map.flyTo (prevents cycles) |
| Feature render | 3 sublayers (Fill+Line+Circle) per layer; heatmap → DeckGL |
| `handleFeatureClick` | queryRenderedFeatures → `queueMicrotask` → `editorState.selectFeature()` |

### DrawingToolbar.svelte
| Function | Responsibility |
|----------|---------------|
| `DT:initTerraDraw` | `editorState.initDrawing(map)` + register finish handler |
| `onfinish` | Routes to: onregiondrawn, onmeasured, or saveFeature |
| `featureUpsertMutation` | TanStack createMutation; hotOverlay preview; query invalidation |
| `syncToolToTerraDraw` | `$effect` syncs `editorState.activeTool` → Terra Draw mode |
| `featureDeleteMutation` | Raw trpc call (inconsistency — no TanStack wrapper) |

### useKeyboardShortcuts.svelte.ts
| Function | Responsibility |
|----------|---------------|
| `handleKeydown` | Escape → cancel draw/pick; Ctrl+Z → undo/redo; 1/2/3 → tool switch |

Types imported from `map-editor-state.svelte.js`. Interface uses dependency injection — no direct store import.

### MapEditorState (stores/map-editor-state.svelte.ts)
| Method | Responsibility |
|--------|---------------|
| `transitionTo(next)` | Discriminated-union state machine + inline tool sync |
| `selectFeature(f, coords, layerId?)` | Atomic: resolves feature ID → updates selection + interaction + tool |
| `clearSelection()` | Atomic: resets selection fields + transitions to idle |
| `handleSectionChange(section)` | Cleans stale draw/pick/measure modes when sidebar changes |
| `handleDesignModeChange(dm)` | Resets all interaction state on design mode entry |
| `initDrawing(map)` | Generation-guarded async: import terra-draw → create instance → start |
| `stopDrawing()` | Safe teardown with error swallow |
| `reset()` | Full state reset — test isolation and component teardown |

## Stratigraphy

### FAULTS (partial migrations)
- **Clean.** No remaining imports of deleted stores outside test files. All production code routes through `MapEditorState`.
- `useKeyboardShortcuts` `KeyboardShortcutsDeps.selectionStore` field name is a naming vestige — actually wired to `editorState` methods by MapEditor. Functional but misleading.

### DIAGENESIS (load-bearing TODOs)
- **9 TYPE_DEBT annotations** survive (DrawingToolbar: 3, MapCanvas: 4, DeckGLOverlay: 2). All predate the consolidation. None are new technical debt from this change.
- No HACK or FIXME annotations in the subsystem.

### METAMORPHISM (modern syntax hiding old assumptions)
- `KeyboardShortcutsDeps` interface uses pre-consolidation naming (`selectionStore`, `transitionTo` as separate deps) while the backing implementation is now a unified class. The abstraction works but the naming doesn't reflect the new architecture.

### INVERTED STRATA (newer files with older patterns)
- `interaction-modes.test.ts` reimplements the state machine locally rather than using `MapEditorState`. This is intentional (tests the behavioral contract independently) but duplicates ~100 LOC of state machine logic that could drift.

## Cross-Cutting Patterns

1. **Atomic methods over effect chains** — MapEditorState methods update all affected state synchronously. No `$effect` coordination needed between interaction/selection/tool state. This eliminates the 5-effect bridge.
2. **Svelte 5 context delivery** — `setContext`/`getContext` with Symbol key. No global singletons for interaction state.
3. **Generation counters** — `#drawingGeneration` guards async Terra Draw init races. `mapStore._viewportVersion` guards viewport sync.
4. **queueMicrotask for MapLibre callbacks** — `handleFeatureClick` defers state writes to avoid Svelte 5's 1000-iteration depth limit during initial effect flush.
5. **Effect-tracker discipline** — all `$effect` blocks tagged with prefix codes (`ME:`, `MC:`, `DT:`) via `effectEnter`/`effectExit`.
6. **Server-first mutations** — no optimistic updates; `hotOverlay` is bespoke optimistic layer for draws only.
7. **TYPE_DEBT annotations** — 9 surviving, all at library type boundaries (terra-draw, deck.gl, MapLibre).

## Hotspots

| File | Why |
|------|-----|
| `MapCanvas.svelte` (~700 LOC) | Highest complexity — sublayer rendering, FSL filter/style, click handling, viewport sync |
| `DrawingToolbar.svelte` (~300 LOC) | Terra Draw lifecycle, tool sync effect, mutation handling |
| `map-editor-state.svelte.ts` (~250 LOC) | Single source of truth — any interaction bug traces here |

## Risks

- **hotOverlay not cleaned on mutation failure** — preview feature persists with no server backing (unchanged from previous scan)
- **featureDeleteMutation bypasses TanStack Query** — no cache invalidation, no loading state (unchanged)
- **interaction-modes.test.ts drift risk** — local state machine reimplementation may diverge from `MapEditorState` as the class evolves
- **KeyboardShortcutsDeps naming** — `selectionStore` field name suggests old architecture; should be renamed to `editorState` for clarity

## Quality Assessment

| Lens | Rating | Notes |
|------|--------|-------|
| **Quality** | Good | Atomic methods eliminate effect-chain bugs. Private fields enforce encapsulation. TYPE_DEBT is documented, not hidden. |
| **Evolution** | Improved | 3 stores + 1 bridge → 1 class. Drainage density dropped significantly. Context delivery is the modern Svelte 5 pattern. |
| **Convention** | Consistent | Effect-tracker prefix discipline maintained. Generation-counter pattern preserved. Server-first mutation pattern unchanged. |

**See also:** [contracts](contracts.md) | [modules](modules.md) | [subsystems](../subsystems.md)
