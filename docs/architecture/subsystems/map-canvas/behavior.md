# Map Canvas -- Behavior (L8)

> Runtime behavior traces, state flows, and diagnostic findings for subsystem #2.
>
> **See also:** [components](components.md) | [contracts](contracts.md) | [map-editor/behavior](../map-editor/behavior.md)

## Flow Trace: Click-to-Selection

```
User clicks a feature on the map
  |
  v
MapLibre CircleLayer/FillLayer/LineLayer onclick handler fires
  |
  v
handleFeatureClick(feature, event, layerStyle, layerId)
  |
  +-- Guard: if activeTool is point/line/polygon -> RETURN (block during draw)
  |
  +-- queueMicrotask(() => {
  |     selectedLayerStyle = layerStyle;           // local state for popup formatting
  |     editorState.selectFeature(feature, coords, layerId);
  |   })
  |
  v  (microtask executes)
MapEditorState.selectFeature() -- ATOMIC, synchronous:
  1. Sets #selectedFeature = feature
  2. Sets #selectedFeatureIds = Set([feature.id])
  3. Sets #popupCoords = coords
  4. Sets #selectedLayerId = layerId
  5. Transitions #interactionState:
     - idle/featureSelected -> { type: 'featureSelected', feature: {...} }
     - pickFeature (no pick yet) -> { type: 'pickFeature', picked: {featureId, layerId} }
     - drawRegion/pendingMeasurement -> no transition (silent update)
  |
  v
Svelte reactivity propagates:
  - editorState.popupCoords changes -> <Popup> renders at coords
  - editorState.selectedFeature changes -> <FeaturePopup> renders properties
  - layerRenderCache recomputes -> highlight paint expression activates
```

### Empty-Area Click (Deselection)

```
User clicks empty area on map
  |
  v
<MapLibre onclick={...}>
  |
  +-- editorState.clearSelection()
        ATOMIC:
        1. Nulls selectedFeature, selectedFeatureIds, popupCoords, selectedLayerId
        2. If interactionState was featureSelected -> transitions to idle
  |
  v
  - Popup disappears (popupCoords is null)
  - Highlight paint expression deactivates (selectedFeature is null)
```

### Popup Close (via X button)

```
<Popup onclose={() => { editorState.clearSelection(); selectedLayerStyle = undefined; }}>
```

Same clearSelection() path as empty-area click, plus local style reset.

## Flow Trace: Viewport State Management

Two-directional sync with cycle prevention via `viewportVersion` counter.

### User Pan/Zoom (Map -> Store)

```
User drags/zooms map
  |
  v
MapLibre move handler fires (svelte-maplibre-gl binding)
  -> Updates bound $state: mapCenter, mapZoom
  |
  v
MC:localToStore effect triggers (tracks mapCenter, mapZoom)
  -> untrack(() => { mapStore.setViewport({center, zoom}) })
  |
  v
mapStore.setViewport() updates _center, _zoom
  NOTE: Does NOT increment _viewportVersion
  -> MC:storeToLocal does NOT re-fire (tracks only viewportVersion)
  -> NO CYCLE
```

### Programmatic Viewport Change (Store -> Map)

```
mapStore.loadViewport() called (e.g. "fly to saved view")
  -> Updates _center, _zoom, _bearing, _pitch
  -> Increments _viewportVersion++
  |
  v
MC:storeToLocal effect triggers (tracks viewportVersion)
  -> untrack(() => reads center, zoom, bearing, pitch from mapStore)
  -> Updates local $state: mapCenter, mapZoom, mapBearing, mapPitch
  |
  v
svelte-maplibre-gl binding detects change -> map.flyTo() / map.easeTo()
  -> MapLibre move handler fires -> updates bound $state (same values)
  -> MC:localToStore fires -> setViewport (same values, no-op in practice)
  -> Does NOT increment viewportVersion -> MC:storeToLocal stays dormant
  -> NO CYCLE
```

### Initialization Hazard (Documented)

MapCenter/mapZoom are **initialized from mapStore** (not undefined). This is critical:
svelte-maplibre-gl's move handler has two branches:
- If `center` exists: writes only on change (safe)
- If `center` is undefined: writes `tr.center` on EVERY frame

Starting with undefined triggers `undefined -> value` transitions on every frame,
cascading into `effect_update_depth_exceeded`. The initialized values prevent this.

## Flow Trace: Layer Rendering

```
layersStore.all changes (layer added/removed/visibility toggled)
  |
  v
layerRenderCache recomputes ($derived.by)
  -> For each visible layer: compute fillPaint, linePaint, circlePaint, etc.
  -> Memoized: same object references if inputs unchanged
  |
  v
Template {#each layersStore.all} re-evaluates
  -> Reads layerRenderCache[layer.id] (stable references)
  -> svelte-maplibre-gl compares by reference -> no repaint unless cache changed
```

### Dual Rendering Path

```
layer.featureCount > VECTOR_TILE_THRESHOLD && PUBLIC_MARTIN_URL configured?
  |
  YES -> VectorTileSource (Martin tiles)
  |       + vtFilter (includes layer_id equality check)
  |       + hot overlay GeoJSON source for immediate draw preview
  |
  NO  -> GeoJSONSource (client-side data)
          + standard filter (FSL + UI filters only)
```

### Heatmap Bypass

```
layer.style.type === 'heatmap'?
  |
  YES -> Skip MapLibre rendering entirely
  |      -> Feed to DeckGLOverlay via heatmapLayerDefs derived
  |      -> deck.gl HeatmapLayer renders on separate canvas
  |
  NO  -> Normal MapLibre FillLayer + LineLayer + CircleLayer
```

## The queueMicrotask Workaround

**Location:** `handleFeatureClick()` (line ~480) and annotation pin/region click handlers.

**Problem:** MapLibre click handlers can fire during Svelte 5's initial effect flush.
When the page is loading and all map layers are mounting, the effect iteration counter
is already at ~900+. Writing reactive state synchronously (e.g., `editorState.selectFeature()`)
adds to the current flush, pushing past Svelte 5's 1000-iteration depth limit.

**Solution:** `queueMicrotask(() => { editorState.selectFeature(...) })` defers the
state write to after the current synchronous flush completes.

**Risk assessment:**
- **Safe:** Microtasks execute before the next animation frame. No user-visible delay.
- **Not a race condition:** The click event data (feature, coords) is captured synchronously
  in closure variables before the defer.
- **Invisible in debug traces:** The mutation logging happens inside the microtask,
  so effect-tracker cannot attribute it to the original click event.
- **Removal condition:** If Svelte 5 raises the 1000-iteration limit (or the mount
  effect count decreases significantly), this workaround can be safely removed.

**Applied consistently:** All three click contexts (feature click, annotation pin click,
annotation region click) use the same pattern for consistency.

## Endorheic Basins (State Accumulation)

### hotOverlay

`hotOverlay` accumulates features per layer without automatic cleanup.

**Drainage paths:**
- `clearHotFeatures(layerId)` called by MapEditor when a layer is deleted
- `clearHotFeatures()` (all) called on component teardown
- `removeHotFeature(layerId, featureId)` called when a VT tile rebuild confirms the feature

**Risk:** If a VT rebuild fails or is never triggered, hot features accumulate indefinitely.
No TTL or size limit. For typical usage (handful of drawn features between rebuilds),
this is not a practical concern. At scale (automated bulk draws without tile rebuilds),
memory could grow.

### selectedAnnotation / hoveredAnnotation

Local `$state` in MapCanvas -- no accumulation risk. Set on hover/click, cleared on
mouse leave / popup close. Single value, not a collection.

### layerRenderCache

`$derived.by` -- automatically garbage-collected when dependencies change. Entries for
removed/hidden layers are excluded on recomputation. No accumulation risk.

### firstLabelLayerId

Single string, re-derived on `style.load` events. No accumulation risk.
Cleanup: `mapInstance.off('style.load', updateFirstLabel)` in effect return.

## Annotation Layer Stack

Render order (bottom to top):
1. Data layers (GeoJSON / VectorTile sources)
2. Hot overlay layers (GeoJSON, same paint as data layers)
3. Annotation highlight sublayers (amber outline on annotated features)
4. Annotation region polygons (blue semi-transparent fill)
5. Annotation region outlines (blue line)
6. Feature annotation badges (amber circles with count labels)
7. Annotation pins (amber circles)
8. Measurement annotation geometries (dashed amber lines/fills with labels)
9. Feature popup (MapLibre Popup element)
10. Annotation hover tooltip (MapLibre Popup, compact)
11. Annotation click popup (MapLibre Popup, full content)

Popups (9-11) are MapLibre DOM elements, not canvas layers -- they float above all layers.

## Effect Inventory

| Label | Tracks | Writes | Purpose |
|-------|--------|--------|---------|
| `MC:syncMapInstance` | `mapInstance` | `mapStore.setMapInstance()` | Sync map ref to global store |
| `MC:storeToLocal` | `mapStore.viewportVersion` | local mapCenter/mapZoom/mapBearing/mapPitch | Programmatic viewport -> map |
| `MC:localToStore` | `mapCenter`, `mapZoom` | `mapStore.setViewport()` (untracked) | User pan/zoom -> store |
| `MC:firstLabelLayer` | `mapInstance` | `firstLabelLayerId` | Find basemap symbol layer for sandwich |

**Derived computations (not effects):**
- `heatmapLayerDefs` -- layers with heatmap style -> deck.gl defs
- `layerRenderCache` -- all visible layers -> memoized paint/filter props
- `annotatedByLayer` -- annotatedFeatures map -> grouped by layerId
- `badgeGeoJson` -- annotatedFeatures -> point FeatureCollection for badge layer

## Cross-References

- **MapEditor controls interaction state:** [map-editor/behavior](../map-editor/behavior.md)
  documents the `handleSectionChange` and `handleDesignModeChange` effects that
  reset MapCanvas's interaction context when sections or modes change.
- **DrawingToolbar lifecycle:** DrawingToolbar calls `editorState.initDrawing(map)` and
  `editorState.stopDrawing()`. These are MapEditorState methods, not MapCanvas methods.
  MapCanvas merely provides the `map` instance as a prop.
- **DataTable selection sync:** DataTable reads `editorState.selectedFeatureIds` and calls
  `editorState.toggleFeatureId()`. This is independent of MapCanvas -- both components
  read from the same context but do not communicate directly.
