# Drawing Tools -- Behavior (L8)

## 1. Draw-Mode Activation Trace

**Trigger:** User clicks a tool button in the toolbar (e.g., "Polygon").

```
User clicks polygon button
  |
  v
setTool('polygon')                          [DrawingToolbar:315]
  |-- isDrawing()? If yes, confirm discard
  |-- editorState.setActiveTool('polygon')  [MapEditorState:146]
  |     |-- #activeTool = 'polygon'
  |     |-- Clears selection (draw tool != 'select')
  |     |-- If featureSelected -> transition to idle
  |
  v
$effect DT:syncToolToTerraDraw fires       [DrawingToolbar:230]
  |-- Reads editorState.activeTool (reactive dependency)
  |-- Maps tool to Terra Draw mode: polygon -> 'polygon'
  |-- Checks for in-progress geometry (snapshot filter)
  |   |-- If in-progress: setTimeout -> confirm -> removeFeatures -> setMode
  |   |-- If clean: editorState.drawingInstance.setMode('polygon')
  |
  v
Terra Draw enters polygon drawing mode
  User clicks to add vertices
  Double-click to close shape
  |
  v
Terra Draw fires 'finish' event with feature ID
```

**Key design:** `setTool()` does NOT call `setMode()` directly. It sets `activeTool` on the state class, and the `$effect` (DT:syncToolToTerraDraw) handles the actual Terra Draw mode switch. This avoids a dual-write race where both paths fire and Terra Draw throws on stale internal state.

## 2. Save Flow Trace

**Trigger:** Terra Draw `finish` event fires with a feature ID.

```
draw.on('finish', id)                       [DrawingToolbar:83]
  |
  v
getSnapshotFeature(id)                      [DrawingToolbar:86]
  |
  +-- onregiondrawn? -> pass geometry to parent, STOP
  +-- onmeasured?    -> measureFeature(), STOP
  +-- else           -> saveFeature(f)
  |
  v
saveFeature(f)                              [DrawingToolbar:154]
  |-- Check layersStore.active (no layer -> toast error, STOP)
  |-- Serialize geometry + properties to plain Records
  |
  v
featureUpsertMutation.mutateAsync()         [DrawingToolbar:167]
  |-- tRPC features.upsert.mutate()
  |-- onSuccess: invalidateQueries(features.list({ layerId }))
  |-- onError: clearHotFeatures() + toast
  |
  v
(on success)
  |-- hotOverlay.addHotFeature()            [DrawingToolbar:175]
  |     (immediate visual feedback for vector tile layers)
  |
  v
undoStore.push({ undo, redo })              [DrawingToolbar:183]
  |-- undo: features.delete + removeHotFeature
  |-- redo: features.upsert + addHotFeature
  |
  v
onfeaturedrawn(layerId, feature)            [DrawingToolbar:209]
  |
  v
MapEditor.handleFeatureDrawn()              [MapEditor:209]
  |-- If not large layer: loadLayerData(layerId)
  |     fetchQuery() sees stale cache -> re-fetches
  |-- logActivity('feature.create', ...)
  |
  v
(back in DrawingToolbar finish handler)
  |-- removeFeatures([id])                  [DrawingToolbar:107]
  |     (remove from Terra Draw overlay -- feature now in GeoJSON source)
  |-- setMode('select')                     [DrawingToolbar:113]
  |-- setActiveTool('select')               [DrawingToolbar:114]
```

**Ordering matters:** `onfeaturedrawn` is awaited BEFORE `removeFeatures`. This ensures the GeoJSON source is updated before Terra Draw's overlay is cleared, preventing a visual gap where the feature disappears momentarily.

## 3. Race Condition Analysis

### Old Architecture (3 stores + bridge)

Five `$effect` chains in `useInteractionBridge` synchronized three stores:
- Drawing state changes -> selection changes -> interaction mode changes
- Each effect could re-trigger others, creating cascading async races
- Known bugs: selection state arriving before drawing state settled

### Current Architecture (MapEditorState)

All state transitions are **synchronous atomic methods** on a single class:

| Method | Atomically Updates |
|--------|--------------------|
| `transitionTo()` | `#interactionState` + `#activeTool` (if drawRegion/pickFeature) |
| `selectFeature()` | `#selectedFeature` + `#selectedFeatureIds` + `#popupCoords` + `#selectedLayerId` + `#interactionState` |
| `clearSelection()` | All selection fields + `#interactionState` (if featureSelected) |
| `setActiveTool()` | `#activeTool` + all selection fields (if draw tool) + `#interactionState` |

**No inter-store effects remain.** The only `$effect` chains are in DrawingToolbar itself:
1. `DT:initTerraDraw` -- lifecycle (depends only on `map` prop)
2. `DT:syncToolToTerraDraw` -- mode sync (depends on `activeTool`)
3. Escape key handler (depends on `isDrawingReady`)

These are leaf effects -- they read state and call imperative Terra Draw APIs. They do not write back to MapEditorState in ways that would trigger each other.

**Remaining async gap:** `initDrawing()` is async (dynamic import). The generation guard (`#drawingGeneration`) prevents stale completions from overwriting newer inits. This is the same pattern from the old `drawingStore` and is well-tested (see `map-editor-state.test.ts` generation guard tests).

**Verdict:** The old cross-store race conditions are structurally eliminated. The only async operation (Terra Draw init) is properly guarded.

## 4. Endorheic Basin Analysis: Terra Draw State Accumulation

**Question:** Does Terra Draw's internal feature store accumulate state that is never cleaned up?

### Cleanup Points

1. **After `finish` event:** `removeFeatures([id])` at line 107 -- always runs (even after failed save, via the catch block at line 214/222).

2. **Tool switch with in-progress geometry:** `DT:syncToolToTerraDraw` effect checks `snapshot.filter(f => f.properties?.mode !== 'static')` and removes in-progress features before mode switch (line 248).

3. **Escape key:** Effect at line 271 filters for non-static features and removes them.

4. **Basemap swap:** `style.load` handler calls `editorState.reset()` then `initDrawing()` -- creates a fresh Terra Draw instance, old one is garbage collected.

5. **Component unmount:** Cleanup function calls `editorState.stopDrawing()` which calls `draw.stop()`.

### Potential Accumulation Vectors

| Vector | Risk | Mitigation |
|--------|------|------------|
| Failed `removeFeatures` | Low | Wrapped in try/catch, logged. Next mode switch or basemap swap will clear. |
| Multiple rapid draws before server responds | Low | Each `finish` handler runs independently. Features are removed after their individual save completes. |
| Measurement/region features | None | These features are removed in the same `finish` handler (line 107) regardless of mode. |
| Terra Draw internal undo history | Unknown | Terra Draw may maintain internal history. Cleared on `stop()`/new instance. Not a memory concern for typical session lengths. |

**Verdict:** No endorheic basins identified. Every created feature has a removal path. The basemap-swap re-init provides a hard reset boundary. The only theoretical accumulation is Terra Draw's internal state during very long sessions without basemap changes, but `stop()` on unmount handles this.

## 5. Noted Issues

### 5a. Duplicate Escape Key Handlers

There are two Escape key handlers:
- `$effect` at line 271 that adds a `document.addEventListener('keydown', ...)`
- `handleKeydown` at line 308 bound via `<svelte:window onkeydown={handleKeydown}>`

Both check for Escape and call similar cleanup logic. The `$effect` version filters snapshot for in-progress features; the `handleKeydown` version checks `isDrawing()` (getModeState). They could conflict or double-fire. Low severity -- both paths converge on the same outcome (clear + select mode) -- but it is unnecessary duplication.

### 5b. Double removeFeatures in saveFeature Error Path

In the `catch` block of `saveFeature()` (lines 210-226), `removeFeatures` is called twice:
- Line 214: inside an inner try/catch
- Line 222: in a second try/catch immediately after

The second call will always throw (feature already removed or never existed) and be silently caught. No functional impact but dead code.

### 5c. Undo Command Captures Layer by Closure

The undo/redo closures capture `activeLayer.id` at draw time. If the layer is deleted before undo, the delete/upsert mutation will fail. The mutation's `onError` handler shows a toast, which is acceptable degradation, but the undo stack entry remains (cannot be retried meaningfully).
