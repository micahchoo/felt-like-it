# Map Editor Cluster — Components & Modules

## Component Tree

```
MapEditor (orchestrator, ~500 LOC, 62 commits)
├── MapCanvas (~450 LOC, 25 commits)
│   ├── DrawingToolbar (~300 LOC, 25 commits)
│   │   └── DrawActionRow (~50 LOC)
│   ├── FeaturePopup
│   ├── AnnotationContent (in-map popup)
│   └── DeckGLOverlay (97 LOC, heatmap)
├── LayerPanel (~200 LOC, 11 commits)
├── BasemapPicker (72 LOC)
├── SidePanel
│   ├── DataTable, FilterPanel, StylePanel, Legend
│   ├── ActivityFeed (230 LOC)
│   ├── MeasurementPanel, GeoprocessingPanel
│   └── AnnotationPanel (~1200 LOC)
├── ImportDialog, ExportDialog
└── ShareDialog
```

**Key pattern:** MapCanvas owns DrawingToolbar — drawing state flows through shared stores, not props.

## State Architecture

Eight stores in two rings:

**Core rendering ring** (MapCanvas reads):
- `mapStore` — MapLibre instance + viewport + `_viewportVersion` race guard
- `layersStore` — reactive Layer array, activeLayerId, visibility map
- `filterStore` — per-layer UIFilter[], persisted to localStorage, exposes `fslFiltersToMapLibre`
- `styleStore` — per-layer LayerStyle overrides (Map), editingLayerId, showLegend

**Interaction ring** (MapEditor + DrawingToolbar read):
- `selectionStore` — selectedFeature, activeTool (DrawTool), popupCoords
- `interactionModes` — discriminated union state machine (idle | featureSelected | drawRegion | pickFeature | pendingMeasurement)
- `drawingStore` — Terra Draw lifecycle (idle | importing | ready | stopped) + generation counter
- `undoStore` — Command stack (past/future, MAX_HISTORY=50)

**Utility:**
- `viewport.svelte.ts` — factory for paginating features by map bounds (DataTable use)
- `map-sources.svelte.ts` (`hotOverlay`) — in-memory Feature[] for live drawing preview

## Key Modules

### MapEditor.svelte
| Function | Responsibility |
|----------|---------------|
| `isLargeLayer(layer)` | Gates tile vs GeoJSON path (>10K features + Martin) |
| `logActivity(action, metadata)` | Fire-and-forget events.log + bump activityRefreshTrigger |
| `fetchViewportFeatures` (effect) | Per-layer features.list → source.setData() |
| saveViewport | maps.update + undo Command |

### MapCanvas.svelte
| Function | Responsibility |
|----------|---------------|
| `MC:syncMapInstance` | Push MapLibre instance to mapStore |
| `MC:storeToLocal` | Viewport version → map.flyTo (prevents cycles) |
| Feature render | 3 sublayers (Fill+Line+Circle) per layer; heatmap → DeckGL |
| `handleMapClick` | queryRenderedFeatures → selectionStore.selectFeature |

### DrawingToolbar.svelte
| Function | Responsibility |
|----------|---------------|
| `DT:initTerraDraw` | drawingStore.init(map) + register finish handler |
| `onfinish` | Routes to: onregiondrawn, onmeasured, or featureUpsertMutation |
| `featureUpsertMutation` | TanStack createMutation; hotOverlay preview; query invalidation |
| `featureDeleteMutation` | Raw trpc call (inconsistency — no TanStack wrapper) |

### interaction-modes.svelte.ts — State Machine
States: `idle | featureSelected | drawRegion | pickFeature | pendingMeasurement`
Transitions via `transitionTo(next)` (pure). Side-effect: `$effect` syncs `selectionStore.setActiveTool`.

**Dual-state issue:** `mapStore.InteractionMode` (legacy enum) coexists with `interactionModes.InteractionState`. Unclear if legacy is consumed.

## Cross-Cutting Patterns

1. **Effect-tracker discipline** — all `$effect` blocks tagged with prefix codes (`ME:`, `MC:`, `DT:`) via `effectEnter`/`effectExit`
2. **Server-first mutations** — no optimistic updates; `hotOverlay` is bespoke optimistic layer for draws only
3. **Generation counters** — `drawingStore._generation` and `mapStore._viewportVersion` guard async races
4. **TYPE_DEBT annotations** — features.list returns untyped geometry (`Record<string, unknown>`)
5. **localStorage persistence** — filterStore, ActivityFeed category state

## Risks

- **hotOverlay not cleaned on mutation failure** — preview feature persists with no server backing
- **No component tests** for MapEditor or MapCanvas — only store-level unit tests
- **featureDeleteMutation bypasses TanStack Query** — no cache invalidation, no loading state

**See also:** [contracts](contracts.md) | [behavior](behavior.md) | [subsystems](../subsystems.md)
