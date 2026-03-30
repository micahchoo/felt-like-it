# Map Canvas -- Components & Modules (L5 + L7)

> Subsystem #2. Covers MapLibre GL rendering, deck.gl overlay, click/hover events,
> viewport state, and map-sources utilities.
>
> **See also:** [contracts](contracts.md) | [behavior](behavior.md) | [map-editor/](../map-editor/)

## File Inventory

| File | Lines | Responsibility | Owner |
|------|-------|----------------|-------|
| `MapCanvas.svelte` | ~960 | MapLibre rendering, layer iteration, click/hover, viewport sync, annotation layers | MapCanvas subsystem |
| `DeckGLOverlay.svelte` | ~95 | deck.gl HeatmapLayer via MapboxOverlay IControl | MapCanvas subsystem |
| `FeaturePopup.svelte` | small | Renders selected-feature property table inside a MapLibre Popup | MapCanvas subsystem |
| `map-sources.svelte.ts` | ~50 | `hotOverlay` -- in-memory Feature[] per layer for live drawing preview on VT layers | **Ambiguous** (used by MapCanvas + DrawingToolbar + MapEditor) |
| `map-editor-state.svelte.ts` | ~255 | `MapEditorState` class -- unified interaction/selection/drawing state | Shared (context-provided) |

## Internal Structure of MapCanvas.svelte

### Script Block (~530 lines)

```
Imports & types           (1-25)     svelte-maplibre-gl components, maplibregl types, stores
Annotation interfaces     (26-62)    AnnotationPin, AnnotationRegion collections
Props interface           (64-94)    10 props (see contracts.md)
State initialization      (96-99)    getMapEditorState(), mapInstance binding
Viewport sync effects     (100-161)  MC:syncMapInstance, MC:storeToLocal, MC:localToStore
firstLabelLayer effect    (163-183)  Finds first basemap symbol layer for sandwich ordering
Heatmap derivation        (185-211)  $derived: layersStore -> HeatmapLayerDef[] for deck.gl
Vector tile helpers       (213-244)  usesVectorTiles(), martinTileUrl(), getVectorTileFilter()
Paint constants           (246-283)  PAINT_DEFAULTS, annotation/badge/measure paint objects
Layer render cache        (285-334)  $derived.by: memoized per-layer paint/filter/layout
Paint builders            (336-441)  getLayerPaint(), getLabelAttribute(), getLayerFilter(), etc.
Symbol builders           (443-466)  getSymbolPaint(), getSymbolLayout()
Click handlers            (468-490)  handleFeatureClick() with queueMicrotask
Annotation popup state    (492-530)  hoveredAnnotation, selectedAnnotation, badgeGeoJson
```

### Template Block (~430 lines)

```
MapLibre wrapper          (531-540)  <MapLibre> with viewport bindings, onclick=clearSelection
Layer iteration           (541-690)  {#each layersStore.all} -> GeoJSON or VectorTile source
  Per layer:                         FillLayer + LineLayer + CircleLayer + SymbolLayer (optional)
  Click wiring:                      Each sublayer onclick -> handleFeatureClick()
Hot overlay iteration     (691-710)  {#each} for VT layers: immediate preview of drawn features
Feature popup             (711-720)  <Popup> bound to editorState.popupCoords
Annotation pins           (721-790)  GeoJSONSource + CircleLayer with hover/click handlers
Annotation regions        (791-850)  GeoJSONSource + FillLayer + LineLayer
Annotation badges         (851-880)  GeoJSONSource + CircleLayer + SymbolLayer
Measurement annotations   (881-920)  GeoJSONSource + LineLayer + FillLayer + SymbolLayer
Hover/click popups        (921-950)  Two <Popup> blocks for annotation content
DeckGLOverlay             (951)      <DeckGLOverlay map={mapInstance} layers={heatmapLayerDefs}>
DrawingToolbar            (953-960)  Conditional on !readonly && mapInstance
```

## Internal Structure of DeckGLOverlay.svelte

Pure side-effect component -- renders nothing to DOM. All rendering via deck.gl canvas
injected by `map.addControl()`.

```
Props                     (30-44)    map: MapLibreMap, layers: HeatmapLayerDef[]
Lifecycle effect          (55-69)    Creates MapboxOverlay on mount, removeControl on teardown
Sync effect               (73-95)    Pushes updated HeatmapLayer[] to overlay.setProps()
```

**Integration pattern:** `interleaved: false` -- deck.gl renders on a **separate canvas** above
the MapLibre canvas. Avoids shared-WebGL-context issues. Fully compatible with MapLibre 5.

TYPE_DEBT: MapboxOverlay's IControl type diverges from maplibre-gl 5's IControl.
Cast through `unknown` at addControl/removeControl boundaries. Runtime-compatible.

## hotOverlay (map-sources.svelte.ts)

Module-level reactive store using Svelte 5 `$state`. Not a class -- an object literal
with getter/methods.

**Purpose:** When a user draws a feature on a large (vector-tile) layer, the feature
won't appear in the tile source until the next tile rebuild. `hotOverlay` holds these
"hot" features in a GeoJSON source that renders immediately with the same paint props.

**API surface:**
- `features` (getter) -- Record<string, Feature[]>
- `getCollection(layerId)` -- FeatureCollection for one layer
- `addHotFeature(layerId, feature)` / `removeHotFeature(layerId, featureId)`
- `setSelectedHotFeature(layerId, feature)` -- upsert by feature ID
- `clearHotFeatures(layerId?)` -- clear one layer or all

**Ownership ambiguity:** This file lives in `lib/utils/` (not `lib/components/map/`),
but is consumed exclusively by MapCanvas (template) and DrawingToolbar (writes).
Logically belongs to the MapCanvas subsystem. Could be co-located.

## Layer Render Cache

The `layerRenderCache` is the performance-critical derived store. It solves the
**infinite-loop problem**: svelte-maplibre-gl compares paint objects by reference.
If `getLayerPaint()` is called in the template, it creates a new object each evaluation,
triggering MapLibre repaint, which triggers tile events, which triggers template
re-evaluation -- infinite loop.

The cache is a `$derived.by<Record<string, LayerRenderCache>>` that recomputes only
when `layersStore.all`, `editorState.selectedFeature`, or `filterStore` changes.
Each entry caches: fillPaint, linePaint, circlePaint, symbolPaint, symbolLayout,
filter, vtFilter, labelAttr, clickable, sandwiched, isHeatmap, usesVT, layerStyle.

## Stratigraphy

### Faults (Structural Discontinuities)
- **selectionStore reference in mutation label**: `layerRenderCache` mutation log references
  `selectionStore.selectedFeature` but the actual read is `editorState.selectedFeature`.
  Cosmetic -- mutation labels are debug-only strings.

### Diagenesis (Lithified Temporaries)
- **PAINT_DEFAULTS**: Started as fallback constants, now load-bearing defaults that
  MapLibre 5 requires (crashes on `paint: {}`). Cannot be removed.
- **CANVAS_CTX_ATTRS**: `{ preserveDrawingBuffer: true }` hoisted to constant to prevent
  svelte-maplibre-gl canvas recreation. Must remain stable reference.
- **`as any` casts on filter/layout constants**: BADGE_LABEL_LAYOUT, MEASURE_LABEL_LAYOUT,
  LINESTRING_FILTER, POLYGON_FILTER all use `as any`. These are MapLibre expression arrays
  that TypeScript cannot type-narrow. Stable and runtime-safe.

### Metamorphism (Transformed Code)
- **Old selectionStore/drawingStore/interactionModes** consolidated into `MapEditorState` class.
  MapCanvas now reads from `editorState` (obtained via `getMapEditorState()`) instead of
  three separate module-level stores. The consolidation is complete -- no backward-compat
  aliases remain in MapCanvas.

## Naming Conventions

| Pattern | Convention | Example |
|---------|-----------|---------|
| Effect labels | `MC:<name>` prefix | `MC:syncMapInstance`, `MC:localToStore` |
| Mutation labels | `MC` + field name | `mutation('MC', 'firstLabelLayerId', newId)` |
| Layer IDs | `layer-${layerId}-${type}` | `layer-${layer.id}-fill` |
| Source IDs | `source-${layerId}` | `source-${layer.id}` |
| Hot overlay IDs | `hot-overlay-${layerId}-${type}` | `hot-overlay-${layer.id}-fill` |
| Annotation IDs | `source-annotations`, `layer-annotations-circle` | Fixed strings |
| Constants | SCREAMING_SNAKE | `PAINT_DEFAULTS`, `MARTIN_SOURCE_LAYER` |

## Deadwood

1. **mutation label mismatch**: `selectionStore.selectedFeature` string in the
   `layerRenderCache` mutation call -- should read `editorState.selectedFeature`.
   Debug-only, no runtime impact.
2. **No other dead imports or unused code paths detected.** The consolidation from
   three stores to `MapEditorState` was clean -- no vestigial aliases remain.
