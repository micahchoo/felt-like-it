# Map Editor Cluster — Behavior & Contracts

## Critical Flow Traces

### Map Load → Layers Render → Features Visible

```
Route loads → MapEditor receives initialLayers prop
  → layersStore.init(initialLayers)
  → MapCanvas mounts → MapLibre initializes
  → MC:syncMapInstance → mapStore.setMapInstance(instance)
  → mapStore.loadViewport() → _viewportVersion++ → MC:storeToLocal → map.flyTo()
  → ME:fetchLayerData effect triggers (reactive on layersStore.layers)
      → per-layer: trpc.features.list.query({ layerId })
      → source.setData(fc)  [bypasses svelte-maplibre-gl firstRun guard]
  → {#each layers} → GeoJSONSource + 3 sublayers become visible
```

Large layers (>10K + Martin): skip GeoJSON → VectorTileSource from Martin URL.

### Draw Shape → Feature Saved → Map Updates

```
User clicks draw tool → selectionStore.setActiveTool('polygon')
  → drawingStore.instance.start('polygon')
User completes drawing (double-click)
  → Terra Draw 'finish' event → DT:onfinish handler
  → drawingStore.instance.getSnapshotFeature(id)
  → drawingStore.instance.removeFeatures([id])
  → hotOverlay.add(layerId, f)         [live preview]
  → featureUpsertMutation.mutate(...)
      → onSuccess:
          → queryClient.invalidateQueries → ME:fetchLayerData re-fetches
          → hotOverlay.remove(layerId, f.id)
          → undoStore.push({ undo: delete, redo: upsert })
          → onfeaturedrawn callback → logActivity
```

**Risk:** If mutation fails, hotOverlay entry is NOT cleaned up.

### Layer Style Change → Map Re-renders

```
StylePanel: styleStore.setStyle(layerId, newStyle)
  → MapCanvas derives paint props reactively
  → resolvePaintInterpolators(style.config, zoom) → MapLibre paint expression
  → MapLibre re-renders affected sublayers
User saves → trpc.layers.update.mutate → layersStore.updateStyle
```

**Risk:** Ephemeral window where map shows unsaved style. No revert on mutation error.

### Interaction Mode Switching

```
idle → drawRegion:     selectionStore.setActiveTool('polygon')
     → pickFeature:    selection waits for map click → goto.featureSelected
     → featureSelected: FeaturePopup renders at popupCoords
     → pendingMeasurement: MeasurementPanel receives result
all  → idle:           selectionStore.setActiveTool('select')
```

## Contract Interfaces

### tRPC Calls by Component
| Component | Calls |
|-----------|-------|
| MapEditor | events.log, maps.update, features.list |
| DrawingToolbar | features.upsert (TanStack), features.delete (raw) |
| LayerPanel | layers.create/delete/update/reorder |
| ShareDialog | shares.*, collaborators.* |

### Store Cross-Dependencies
- `interaction-modes` → imports `selectionStore` (only store→store coupling)
- `undoStore` → holds Command closures capturing arbitrary store references
- All other stores are independent

### Props Contract Chain
MapEditor → MapCanvas: `mapId, layers, layerData, annotationPins, onmeasured?, onregiondrawn?`
MapCanvas → DrawingToolbar: `map, onfeaturedrawn?, onmeasured?, onregiondrawn?`

Three callbacks drill down two levels (clean prop drilling, tight coupling for new modes).

**See also:** [components](components.md) | [subsystems](../subsystems.md)
