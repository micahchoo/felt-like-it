# Map Editor Cluster -- Behavior & Contracts

> Re-scanned 2026-03-29. State machine consolidated into `MapEditorState` class.
> Prior version had 5 bridge effects between 3 stores; all eliminated.

## State Machine

### InteractionState (discriminated union)

```
idle ─────────────┬─→ featureSelected    (selectFeature with layerId)
                  ├─→ drawRegion         (transitionTo from annotation/toolbar)
                  ├─→ pickFeature        (transitionTo from annotation flow)
                  └─→ pendingMeasurement (transitionTo from measurement flow)

featureSelected ──┬─→ idle               (clearSelection, Escape, setActiveTool(draw))
                  └─→ featureSelected    (selectFeature replaces atomically)

drawRegion ───────┬─→ idle               (Escape, section change, design mode)
                  └─→ drawRegion         (geometry captured but state type unchanged)

pickFeature ──────┬─→ idle               (Escape, section change, design mode)
                  └─→ pickFeature        (selectFeature captures picked ref)

pendingMeasurement → idle                (section change, design mode)
```

All transitions are **synchronous method calls** on `MapEditorState`.
No `$effect` chains between stores. Two thin `$effect` wrappers in MapEditor
forward external prop changes (`activeSection`, `designMode`) to synchronous methods.

### DrawingState (nested lifecycle)

```
idle → importing → ready → stopped
                     ↑        │
                     └── reset ┘
```

Generation-guarded: concurrent `initDrawing()` calls abort stale imports.
`stopDrawing()` is idempotent (works from any state, always lands on `stopped`).

## Critical Flow Traces

### FB-3: Draw Shape → Feature Saved → Map Updates

```
User clicks draw tool → editorState.setActiveTool('polygon')
  → clears selection atomically (selectedFeature, selectedFeatureIds, popupCoords)
  → if featureSelected: transitions to idle
DrawingToolbar $effect: map prop triggers startDraw()
  → untrack(() => editorState.reset())
  → editorState.initDrawing(map) → TerraDraw imported, started
  → draw.on('finish') handler registered
User completes drawing (double-click)
  → Terra Draw 'finish' event → DT:onfinish handler
  → editorState.drawingInstance.getSnapshotFeature(id)
  → Branch: annotation region → onregiondrawn(geometry)
  → Branch: measurement → measureFeature(f)
  → Branch: normal feature → saveFeature(f):
      → featureUpsertMutation.mutateAsync(...)
      → onSuccess:
          → queryClient.invalidateQueries(queryKeys.features.list)
          → hotOverlay.addHotFeature(layerId, feature)  [live preview for large layers]
          → undoStore.push({ undo: delete+removeHot, redo: upsert+addHot })
      → onfeaturedrawn callback → ME:handleFeatureDrawn
          → loadLayerData(layerId)  [fetchQuery sees stale cache, re-fetches]
          → editorState.transitionTo({ type: 'featureSelected', ... })
  → drawingInstance.removeFeatures([id])  [clears Terra Draw overlay]
  → Catch block: removes orphaned TD geometry on mutation failure
```

**Mutation failure:** hotOverlay is NOT added until after successful mutation
(moved into onSuccess). Terra Draw geometry cleaned in catch block. Prior risk resolved.

### FB-4: Feature Selection + Popup

```
User clicks feature on map → MC:handleFeatureClick
  → Guards: blocks during active draw tools (point/line/polygon)
  → queueMicrotask (avoids Svelte 5 effect_update_depth_exceeded)
      → editorState.selectFeature(feature, coords, layerId)
          ATOMIC: sets selectedFeature, selectedFeatureIds, popupCoords, selectedLayerId
          AND transitions interaction state:
            from idle/featureSelected → featureSelected (normal selection)
            from pickFeature (not yet picked) → pickFeature with picked ref
            from drawRegion/pendingMeasurement → no transition (data updated silently)
  → FeaturePopup renders at popupCoords (reactive on editorState.popupCoords)

User clicks empty map area → MC:handleMapClick
  → editorState.clearSelection()
      ATOMIC: nulls selection state
      AND if featureSelected → transitions to idle

User presses Escape → useKeyboardShortcuts
  → if drawRegion/pickFeature → editorState.transitionTo({ type: 'idle' })
```

**queueMicrotask note:** MapLibre click handlers fire during Svelte's initial
effect flush (~900+ iterations). Deferring to microtask prevents exceeding the
1000-iteration depth limit. Runs before next frame -- not a race condition.

### Map Load → Layers Render → Features Visible

```
Route loads → MapEditor receives initialLayers prop
  → setMapEditorState() provides context to tree
  → layersStore.init(initialLayers)
  → MapCanvas mounts → MapLibre initializes
  → MC:syncMapInstance → mapStore.setMapInstance(instance)
  → mapStore.loadViewport() → _viewportVersion++ → MC:storeToLocal → map.flyTo()
  → useLayerDataManager: per-layer fetchQuery via TanStack cache
      → source.setData(fc)
  → {#each layers} → GeoJSONSource + 3 sublayers become visible
```

Large layers (>VECTOR_TILE_THRESHOLD + Martin): skip GeoJSON → VectorTileSource.

### Layer Style Change → Map Re-renders

```
StylePanel: styleStore.setStyle(layerId, newStyle)
  → MapCanvas derives paint props reactively
  → resolvePaintInterpolators(style.config, zoom) → MapLibre paint expression
  → MapLibre re-renders affected sublayers
User saves → trpc.layers.update.mutate → layersStore.updateStyle
```

**Risk:** Ephemeral window where map shows unsaved style. No revert on mutation error.

### Interaction Mode Switching (consolidated)

```
idle → drawRegion:         editorState.transitionTo({ type: 'drawRegion' })
                           → activeTool synced to 'polygon' inline
     → pickFeature:        editorState.transitionTo({ type: 'pickFeature' })
                           → activeTool synced to 'select' inline
     → featureSelected:    editorState.selectFeature(feat, coords, layerId)
     → pendingMeasurement: editorState.transitionTo({ type: 'pendingMeasurement', ... })
all  → idle:               Escape / clearSelection / section change / design mode toggle
```

## Contract Interfaces

### tRPC Calls by Component
| Component | Calls |
|-----------|-------|
| MapEditor | events.log, maps.update, features.list (via layerDataManager), annotations.list (TanStack) |
| DrawingToolbar | features.upsert (TanStack mutation), features.delete (TanStack mutation) |
| LayerPanel | layers.create/delete/update/reorder |
| ShareDialog | shares.*, collaborators.* |

### TanStack Query Cache

Single `useQueryClient()` in MapEditor, shared by all children via Svelte context.

| Query Key | Owner | Invalidated By |
|-----------|-------|----------------|
| `queryKeys.features.list({ layerId })` | layerDataManager | DrawingToolbar onSuccess |
| `queryKeys.annotations.list({ mapId })` | MapEditor (annotationPinsQuery) | AnnotationPanel mutations |

`loadLayerData` uses `fetchQuery` -- sees stale cache from DrawingToolbar's
`invalidateQueries` and re-fetches. No double-invalidation needed.

### State Ownership (MapEditorState)

All cross-cutting state consolidated into one class, provided via Svelte 5 context:

| State | Access Pattern | Consumers |
|-------|---------------|-----------|
| interactionState | getter + transitionTo() | MapEditor, DrawingToolbar, KeyboardShortcuts |
| selectedFeature/Ids | getter + selectFeature/clearSelection | MapCanvas, DataTable, FeaturePopup |
| activeTool | getter + setActiveTool | MapCanvas, DrawingToolbar, KeyboardShortcuts |
| popupCoords | getter (set via selectFeature) | MapCanvas (FeaturePopup positioning) |
| drawingInstance | getter + initDrawing/stopDrawing | DrawingToolbar |

No store-to-store coupling remains. `undoStore` still holds Command closures.

### Props Contract Chain

MapEditor → MapCanvas: `mapId, layers, layerData, annotationPins, onmeasured?, onregiondrawn?`
MapCanvas → DrawingToolbar: `map, onfeaturedrawn?, onmeasured?, onregiondrawn?`

Three callbacks drill down two levels (clean prop drilling).
State flows up via `MapEditorState` context (not props).

## Diagnostic Findings

### Endorheic Basins: None detected

- `selectedFeatureIds` Set: accumulates via `toggleFeatureId()`, flushed by
  `clearSelection()`, `setActiveTool(draw)`, `handleDesignModeChange(true)`, and `reset()`.
- `hotOverlay`: entries added on mutation success, removed on undo or cache refresh.
  Mutation failure no longer leaves orphans (hotOverlay.add moved to onSuccess path).
- `undoStore` command stack: unbounded but intentional (user-facing undo history).

### Stream Capture: Acceptable

MapEditorState absorbed three former stores:
1. `interaction-modes.svelte.ts` -- state machine transitions
2. `selection.svelte.ts` -- feature selection + popup coords
3. `drawing.svelte.ts` -- TerraDraw lifecycle

All three were tightly coupled via 5 bridge effects that caused race conditions.
Consolidation eliminates the race conditions by making transitions synchronous.
The drawing lifecycle (TerraDraw init/stop) is the heaviest absorbed responsibility
but its generation-guarded async pattern is ~25 lines and ties directly to
interaction state guards. No extraction recommended.

### Bridge Effect Elimination (5 → 0)

| Former Effect | Replacement |
|---------------|-------------|
| ME:selectionToFeature | Inlined in `selectFeature()` |
| ME:featurePickCapture | Inlined in `selectFeature()` pickFeature branch |
| ME:toolDismissFeature | Inlined in `setActiveTool()` |
| ME:sectionCleanup | `handleSectionChange()` called by thin $effect |
| ME:designModeCleanup | `handleDesignModeChange()` called by thin $effect |

### Remaining Risk

- **queueMicrotask in MapCanvas click handler**: necessary workaround for Svelte 5
  effect depth limit. Safe (runs before next frame) but invisible in debug traces.
  If Svelte 5 raises the iteration limit, this can be removed.
- **Unsaved style window**: StylePanel shows unsaved styles with no revert on error.
  Pre-existing, not introduced by consolidation.

**See also:** [contracts](contracts.md) | [modules](modules.md)
