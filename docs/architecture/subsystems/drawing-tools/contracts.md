# Drawing Tools -- Contracts (L6)

## 1. What DrawingToolbar Receives

### From Parent (Props)

| Prop | Source | Required | Purpose |
|------|--------|----------|---------|
| `map` | MapCanvas (MapLibre instance) | Yes | Passed to `initDrawing()` for Terra Draw adapter |
| `onfeaturedrawn` | MapEditor's `handleFeatureDrawn()` | No | Callback after successful save; triggers `loadLayerData()` |
| `onmeasured` | MapEditor (when measurement active) | No | Receives `MeasurementResult`; switches to measurement mode |
| `onregiondrawn` | MapEditor (when `drawRegion` interaction) | No | Receives polygon geometry for annotation region |

### From Context (Svelte Context API)

| Dependency | Access | Purpose |
|------------|--------|---------|
| `MapEditorState` | `getMapEditorState()` | All drawing/interaction state |
| `QueryClient` | `useQueryClient()` | TanStack Query cache invalidation |

### From Module Imports (Singletons)

| Import | Purpose |
|--------|---------|
| `layersStore` | Check `layersStore.active` for save target |
| `undoStore` | Push undo/redo commands after save |
| `trpc` | Feature mutations (upsert, delete) |
| `toastStore` | Error notifications |
| `hotOverlay` | Immediate visual feedback for large layers |
| `queryKeys` | Cache key generation for invalidation |

## 2. What DrawingToolbar Produces

### Events (Callbacks)

| Event | Payload | When |
|-------|---------|------|
| `onfeaturedrawn(layerId, feature)` | Layer ID + geometry/properties/id | After successful `featureUpsertMutation` |
| `onmeasured(result)` | `MeasurementResult` (distance/area) | After measurement-mode draw completes |
| `onregiondrawn(geometry)` | `{ type: 'Polygon', coordinates }` | After region-mode polygon completes |

### tRPC Mutations

| Mutation | Trigger | Side Effects |
|----------|---------|--------------|
| `features.upsert` | `saveFeature()` after Terra Draw `finish` | Invalidates `queryKeys.features.list({ layerId })` |
| `features.delete` | Undo of a drawn feature | Invalidates same cache key |

### State Mutations

| Target | Method | When |
|--------|--------|------|
| `MapEditorState` | `setActiveTool('select')` | After draw completes (reset to select) |
| `MapEditorState` | `reset()` / `initDrawing()` / `stopDrawing()` | Lifecycle: mount, style.load, unmount |
| `undoStore` | `push({ undo, redo })` | After successful save |
| `hotOverlay` | `addHotFeature()` / `removeHotFeature()` | Optimistic UI for vector tile layers |

## 3. Undo Stack Coordination

The undo stack (`apps/web/src/lib/stores/undo.svelte.ts`) is a simple command pattern:

```
Command = { description, undo(), redo() }
Stack: _past[] (max 50) + _future[]
push() -> clears _future (no branching history)
```

DrawingToolbar pushes commands in `saveFeature()`:
- **undo:** `features.delete` + `hotOverlay.removeHotFeature()`
- **redo:** `features.upsert` + `hotOverlay.addHotFeature()`

**Important contract:** The undo command captures `activeLayer.id`, `geometry`, and `properties` by closure. If the layer is deleted between draw and undo, the delete mutation will fail silently (server returns error, toast shown).

## 4. Cache Coordination Contract

```
DrawingToolbar                    MapEditor
     |                                |
     | featureUpsertMutation          |
     |   onSuccess: invalidateQueries |
     |       queryKeys.features.list  |
     |                                |
     | onfeaturedrawn(layerId, feat)  |
     | -----------------------------> |
     |                                | handleFeatureDrawn()
     |                                |   loadLayerData(layerId)
     |                                |     fetchQuery() -- sees stale cache
     |                                |     re-fetches from server
```

**Unified cache strategy:** All feature data flows through TanStack Query. DrawingToolbar's mutation `onSuccess` invalidates the cache key. MapEditor's `loadLayerData` uses `fetchQuery()` which observes the invalidation. No dual-path inconsistency.

## 5. Terra Draw Ownership Contract

| Aspect | Owner | Method |
|--------|-------|--------|
| Instance creation | MapEditorState | `initDrawing(map)` |
| Mode registration | MapEditorState | Point, LineString, Polygon, Select modes |
| start/stop | MapEditorState | `initDrawing()` calls `start()`, `stopDrawing()` calls `stop()` |
| Mode switching | DrawingToolbar | `editorState.drawingInstance.setMode(mode)` |
| Feature capture | DrawingToolbar | `draw.on('finish', ...)` |
| Feature snapshot | DrawingToolbar | `draw.getSnapshotFeature(id)` |
| Feature removal | DrawingToolbar | `draw.removeFeatures([id])` |
| Re-init on basemap swap | DrawingToolbar | `map.on('style.load', startDraw)` |

This split is deliberate: MapEditorState owns the lifecycle (create/destroy), DrawingToolbar owns the behavior (what happens when geometry is created).
