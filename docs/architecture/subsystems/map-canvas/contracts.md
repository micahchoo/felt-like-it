# Map Canvas -- Contracts (L6)

> Subsystem #2 boundary contracts: what MapCanvas accepts, emits, and how it
> interfaces with the shared `MapEditorState` context.
>
> **See also:** [components](components.md) | [behavior](behavior.md) | [map-editor/contracts](../map-editor/contracts.md)

## Props Contract (MapEditor -> MapCanvas)

```typescript
interface Props {
  readonly?: boolean;                    // Suppress drawing toolbar + click interactions
  layerData: Record<string, {            // GeoJSON per layer ID (from useLayerDataManager)
    type: 'FeatureCollection';
    features: GeoJSONFeature[];
  }>;
  onfeaturedrawn?: (layerId, feature) => void;  // Callback: user drew a feature
  annotationPins?: AnnotationPinCollection;      // GeoJSON point pins for annotations
  annotationRegions?: AnnotationRegionCollection; // GeoJSON polygon regions for annotations
  onmeasured?: (result: MeasurementResult) => void; // Measurement mode callback
  onregiondrawn?: (geometry: Polygon) => void;       // Region drawing callback
  annotatedFeatures?: Map<string, { layerId; count }>; // Feature annotation badges
  onbadgeclick?: (featureId: string) => void;          // Badge click callback
  measurementAnnotations?: FeatureCollection;           // Persisted measurement geometries
}
```

**Invocation site** (MapEditor.svelte, template):
```svelte
<MapCanvas
  readonly={effectiveReadonly}
  {layerData}
  onfeaturedrawn={handleFeatureDrawn}
  annotationPins={annotationGeo.pins}
  annotationRegions={annotationGeo.regions}
  {...(measureActive ? { onmeasured: handler } : {})}
  {...(drawRegion && !geometry ? { onregiondrawn: handler } : {})}
  annotatedFeatures={annotationGeo.annotatedFeatures}
  onbadgeclick={scrollToAnnotationFeatureId}
  measurementAnnotations={annotationGeo.measurementAnnotations}
/>
```

Note: `onmeasured` and `onregiondrawn` are conditionally spread -- only present when
the parent is in the relevant interaction state. This is clean: MapCanvas checks
`onmeasured !== undefined` to decide rendering behavior.

## Callback Contract (MapCanvas -> MapEditor)

| Callback | Trigger | Data Shape | Consumer |
|----------|---------|------------|----------|
| `onfeaturedrawn` | DrawingToolbar completes a draw | `(layerId, feature)` | MapEditor.handleFeatureDrawn -> tRPC mutation |
| `onmeasured` | DrawingToolbar completes a measurement draw | `MeasurementResult` | MapEditor -> measureResult state |
| `onregiondrawn` | DrawingToolbar completes region polygon | `{ type: 'Polygon', coordinates }` | MapEditor -> transitionTo(drawRegion) |
| `onbadgeclick` | User clicks annotation badge circle | `featureId: string` | MapEditor -> scroll annotation panel |

These callbacks drill through MapCanvas to DrawingToolbar (two levels).
State flows **up** via `MapEditorState` context, not props.

## MapEditorState Interface (Context Contract)

MapCanvas obtains state via `getMapEditorState()` (Svelte context).

### Reads (MapCanvas reads these reactive properties)

| Property | Type | Used For |
|----------|------|----------|
| `selectedFeature` | `GeoJSONFeature \| null` | Popup rendering, highlight paint expressions |
| `popupCoords` | `{ lng, lat } \| null` | Popup positioning |
| `activeTool` | `DrawTool` | Click guard (block clicks during draw) |
| `interactionState` | `InteractionState` | Not directly read by MapCanvas template |
| `selectedFeatureIds` | `Set<string>` | (Unused in MapCanvas -- used by DataTable) |

### Writes (MapCanvas calls these methods)

| Method | Trigger | Effect |
|--------|---------|--------|
| `selectFeature(feature, coords, layerId)` | Feature click (via queueMicrotask) | Atomic: sets selection + transitions interaction state |
| `clearSelection()` | Empty map click, popup close | Atomic: nulls selection, idle if featureSelected |

**No other MapEditorState methods are called by MapCanvas.** DrawingToolbar (child)
calls `initDrawing()`, `stopDrawing()`, `setActiveTool()`, `transitionTo()` --
but those cross the DrawingToolbar boundary, not MapCanvas.

## Store Dependencies (Direct Reads)

| Store | Import | What MapCanvas Reads |
|-------|--------|---------------------|
| `mapStore` | `$lib/stores/map.svelte.js` | `center`, `zoom`, `bearing`, `pitch`, `viewportVersion`, `basemapUrl`, `interactionMode` |
| `layersStore` | `$lib/stores/layers.svelte.js` | `all` (layer list for iteration) |
| `filterStore` | `$lib/stores/filters.svelte.js` | `toMapLibreFilter(layerId)`, `get(layerId)` |
| `hotOverlay` | `$lib/utils/map-sources.svelte.js` | `getCollection(layerId)` |

**Writes to stores:**
- `mapStore.setMapInstance(instance)` -- on mount/unmount
- `mapStore.setViewport({ center, zoom })` -- on every pan/zoom (MC:localToStore)

## Knot Analysis (Boundary Crossings)

### Inbound (things MapCanvas depends on)

| Source | Crossing Type | Count |
|--------|--------------|-------|
| Props from MapEditor | Data props | 10 |
| MapEditorState context | Reactive reads | 3 properties |
| MapEditorState context | Method calls | 2 methods |
| mapStore | Reactive reads | 6 properties |
| mapStore | Method calls | 2 methods |
| layersStore | Reactive reads | 1 property |
| filterStore | Reactive reads | 2 methods |
| hotOverlay | Reactive reads | 1 method |
| **Total inbound** | | **27** |

### Outbound (things that depend on MapCanvas)

| Target | Crossing Type | Count |
|--------|--------------|-------|
| DrawingToolbar (child) | Props | 4 (map, onfeaturedrawn, onmeasured, onregiondrawn) |
| DeckGLOverlay (child) | Props | 2 (map, layers) |
| FeaturePopup (child) | Props | 2 (feature, style) |
| **Total outbound** | | **8** |

### Assessment

**Knot density: 35 crossings** for a rendering component is moderate. The bulk (27)
is inbound, which is expected -- MapCanvas is a leaf renderer that aggregates many
data sources. The outbound surface (8) is clean: three children with narrow interfaces.

**Tightest coupling:** `mapStore` (8 crossings). This is unavoidable -- MapCanvas IS
the map. The viewport sync protocol (MC:localToStore / MC:storeToLocal) is the most
complex contract and the most likely source of bugs if modified.

## Child Component Contracts

### MapCanvas -> DrawingToolbar
```typescript
{
  map: MapLibreMap;           // Required: live map instance
  onfeaturedrawn?: callback;  // Conditionally spread from parent
  onmeasured?: callback;      // Conditionally spread from parent
  onregiondrawn?: callback;   // Conditionally spread from parent
}
```
DrawingToolbar also reads `MapEditorState` via context (not props).

### MapCanvas -> DeckGLOverlay
```typescript
{
  map: MapLibreMap | undefined;     // Undefined until map loads
  layers: HeatmapLayerDef[];       // Derived from layersStore + layerData
}
```

### MapCanvas -> FeaturePopup
```typescript
{
  feature: GeoJSONFeature;         // The selected feature
  style?: LayerStyle;              // Optional layer style for formatting
}
```
