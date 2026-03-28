# Map Editor Cluster — Contracts

> Zoom level 6: every promise the map-editor subsystem makes to itself and its neighbours.
> Cross-ref: [components](components.md) | [behavior](behavior.md) | [decomposition](decomposition.md)

---

## 1. Store-to-Store Contracts

### Reactive Dependency Graph

```
interactionModes ──imports──> selectionStore
       |                          ^
       | $effect: syncs            |
       | activeTool on state       |
       | transitions               |
       v                          |
  (writes to selectionStore       |
   .setActiveTool)                |
                                  |
undoStore ──closures──> [any store]
       |
       | Command.undo/redo closures
       | capture references to
       | arbitrary stores at
       | push() time
       v
  (runtime coupling, not import-time)

All other stores: ZERO import-time cross-dependencies
```

### Per-Store Contract Table

| Store | File:Line | Reads from other stores | Exposes (public API) | Circular deps? |
|-------|-----------|------------------------|---------------------|----------------|
| **mapStore** | `stores/map.svelte.ts:54` | None | `center`, `zoom`, `bearing`, `pitch`, `basemapId`, `basemapUrl`, `interactionMode`, `mapInstance`, `mapContainerEl`, `viewportVersion`; `setViewport()`, `loadViewport()`, `setMapInstance()`, `setMapContainerEl()`, `setBasemap()`, `setInteractionMode()`, `saveViewportLocally()`, `loadViewportLocally()`, `getViewportSnapshot()` | No |
| **layersStore** | `stores/layers.svelte.ts:6` | None | `all`, `active`, `activeLayerId`; `set()`, `add()`, `update()`, `remove()`, `toggle()`, `setActive()`, `updateStyle()`, `reorder()`, `getOrderedIds()`, `getOrderedIdsWithVersions()` | No |
| **filterStore** | `stores/filters.svelte.ts:96` | None | `get()`, `add()`, `remove()`, `clear()`, `hasFilters()`, `applyToFeatures()`, `toMapLibreFilter()`, `fslFiltersToMapLibre()`; standalone `saveFilters()`, `loadFilters()` | No |
| **styleStore** | `stores/style.svelte.ts:8` | None | `showLegend`, `editingLayerId`; `getStyle()`, `setStyle()`, `clearStyle()`, `toggleLegend()`, `setEditingLayer()` | No |
| **selectionStore** | `stores/selection.svelte.ts:12` | None | `selectedFeatureIds`, `selectedFeature`, `activeTool`, `popupCoords`, `selectedLayerId`, `hasSelection`; `selectFeature()`, `clearSelection()`, `setActiveTool()`, `toggleFeatureId()` | No (but _written to_ by interactionModes) |
| **interactionModes** | `stores/interaction-modes.svelte.ts:65` | **selectionStore** (import, L1) | `state` (InteractionState); `transitionTo()` | **One-way**: interactionModes imports selectionStore and writes to it via `$effect` (L45-63). selectionStore does NOT import interactionModes. |
| **drawingStore** | `stores/drawing.svelte.ts:13` | None (takes `MapLibreMap` as arg) | `state`, `isReady`, `instance`; `init(map)`, `stop()`, `reset()` | No |
| **undoStore** | `stores/undo.svelte.ts:12` | **Runtime only**: Command closures capture arbitrary store refs | `canUndo`, `canRedo`, `undoLabel`, `redoLabel`; `push()`, `undo()`, `redo()`, `clear()` | **Latent**: closures reference drawingStore, layersStore, hotOverlay at push-time |

### Utility Stores (not in the 8-store rings)

| Store | File | Role | Reads |
|-------|------|------|-------|
| **viewport** | `stores/viewport.svelte.ts` | Factory `createViewportStore(deps)` for paginating features by map bounds (DataTable) | Injected via `deps`: `fetchFn`, `getActiveLayer`, `isLargeLayer`, `getMap` |
| **annotation-geo** | `stores/annotation-geo.svelte.ts` | Pure derivation: `AnnotationObject[]` to GeoJSON FeatureCollections | None (takes `() => AnnotationObject[]` factory) |
| **hotOverlay** | `utils/map-sources.svelte.ts:5` | In-memory `Feature[]` per layer for live drawing preview | None |

### The One True Store Coupling

`interactionModes` L45-63 contains a `$effect` that watches `_interactionState` and calls `selectionStore.setActiveTool()`:

```
drawRegion       -> selectionStore.setActiveTool('polygon')
pickFeature      -> selectionStore.setActiveTool('select')
idle (from draw) -> selectionStore.setActiveTool('select')
```

This is the **only** import-time store-to-store dependency. All other coordination happens inside components (MapEditor orchestrates).

---

## 2. Component-to-Store Contracts

### Read/Write Matrix

| Component | Reads | Writes | Concern |
|-----------|-------|--------|---------|
| **MapEditor** | `mapStore` (mapInstance, center, zoom, basemapId, mapContainerEl), `layersStore` (all, active, activeLayerId), `filterStore` (get, hasFilters, applyToFeatures), `styleStore` (editingLayerId), `selectionStore` (selectedFeature, selectedLayerId, activeTool), `interactionModes` (state), `undoStore` (canUndo, canRedo, undoLabel, redoLabel), `hotOverlay` (clearHotFeatures) | `mapStore.setMapContainerEl()`, `mapStore.saveViewportLocally()`, `layersStore.set()`, `layersStore.setActive()`, `selectionStore.clearSelection()`, `selectionStore.setActiveTool()`, `interactionModes.transitionTo()`, `undoStore.undo()`, `undoStore.redo()`, `hotOverlay.clearHotFeatures()`, `filterStore.get()` (reactive dep), `loadFilters()`, `saveFilters()` | **God component**: reads 8/8 stores, writes to 6 stores + 2 utilities |
| **MapCanvas** | `mapStore` (center, zoom, bearing, pitch, viewportVersion, basemapUrl, mapInstance), `layersStore` (all), `selectionStore` (selectedFeature, activeTool, popupCoords), `filterStore` (toMapLibreFilter), `hotOverlay` (getCollection) | `mapStore.setMapInstance()`, `mapStore.setViewport()`, `selectionStore.selectFeature()`, `selectionStore.clearSelection()` | Reads 5 stores, writes to 2 |
| **DrawingToolbar** | `selectionStore` (activeTool), `layersStore` (active), `drawingStore` (isReady, instance, state) | `drawingStore.init()`, `drawingStore.reset()`, `drawingStore.stop()`, `selectionStore.setActiveTool()`, `undoStore.push()`, `hotOverlay.addHotFeature()`, `hotOverlay.removeHotFeature()` | Owns Terra Draw lifecycle, writes to 4 stores |
| **LayerPanel** | `layersStore` (all, activeLayerId) | `layersStore.add()`, `layersStore.remove()`, `layersStore.toggle()`, `layersStore.setActive()`, `layersStore.reorder()`, `styleStore.clearStyle()`, `styleStore.setEditingLayer()` | Layer CRUD, writes to 2 stores |
| **StylePanel** | `styleStore` (getStyle, editingLayerId), `layersStore` (all, active) | `styleStore.setStyle()`, `layersStore.updateStyle()` via trpc callback | Reads 2, writes 2 |

### God Component Leaks

MapEditor writes to stores that conceptually belong to child domains:

| Write | Belongs to | Why it leaks |
|-------|-----------|-------------|
| `selectionStore.setActiveTool('select'/'point'/'polygon')` | DrawingToolbar | Keyboard shortcuts (L457-459) bypass DrawingToolbar entirely |
| `selectionStore.clearSelection()` | MapCanvas popup | Design mode cleanup (L217) |
| `interactionModes.transitionTo()` | Should be interaction-mode bridge | 5 separate `$effect` blocks in MapEditor orchestrate mode transitions |
| `hotOverlay.clearHotFeatures()` | DrawingToolbar | Cleanup on unmount (L469) |
| `layersStore.set()` | LayerPanel | `handleImportComplete` re-fetches layers and sets (L402-406) |

---

## 3. Props Contracts at Each Decomposition Seam

### Seam 1: StatusBar

```typescript
// Extracted: <MapStatusBar>
interface StatusBarProps {
  cursorLat: number;
  cursorLng: number;
  currentZoom: number;
}
// No callbacks. Pure display. Read-only from mapStore.mapInstance events.
// Currently: MapEditor L471-488 ($effect wiring mousemove/zoom listeners)
```

### Seam 2: DialogVisibility

```typescript
// Extracted: useDialogVisibility() composable
interface DialogState {
  showImportDialog: boolean;
  showExportDialog: boolean;
  showShareDialog: boolean;
}
interface DialogActions {
  openImport(): void;
  openExport(): void;
  openShare(): void;
  closeImport(): void;
  closeExport(): void;
  closeShare(): void;
}
// Currently: 3 boolean $state vars + toggling in MapEditor template
```

### Seam 3: LayerDataManager

```typescript
// Extracted: createLayerDataManager() composable
interface LayerDataManagerDeps {
  getMapInstance: () => MapLibreMap | undefined;
  getLayers: () => Layer[];
  isLargeLayer: (layer: Layer) => boolean;
  fetchFeatures: (layerId: string) => Promise<FeatureCollection>;
  onError: (msg: string) => void;
}
interface LayerDataManager {
  readonly layerData: Record<string, FeatureCollection>;
  loadLayerData(layerId: string): Promise<void>;
  handleLayerChange(): Promise<void>;
}
// Dependencies: layersStore.all (read), mapStore.mapInstance (read for getSource().setData()),
//   trpc.features.list.query (read)
// Race guard: loadGeneration counter per layerId (MapEditor L318)
// Direct MapLibre call: map.getSource(`source-${layerId}`).setData(fc) (MapEditor L327)
```

### Seam 4: InteractionModeBridge

```typescript
// Extracted: useInteractionOrchestrator() composable
interface InteractionOrchestratorDeps {
  getInteractionState: () => InteractionState;
  transitionTo: (state: InteractionState) => void;
  getSelectedFeature: () => GeoJSONFeature | null;
  getSelectedLayerId: () => string | null;
  getActiveTool: () => DrawTool;
  getActiveSection: () => string;
  getDesignMode: () => boolean;
  resolveFeatureId: (feat: unknown) => string | undefined;
}
// Owns 5 $effect blocks:
//   ME:sectionCleanup    — reset mode when sidebar section changes
//   ME:designModeCleanup — reset to idle on design mode toggle
//   ME:selectionToFeature — selection -> featureSelected transition
//   ME:toolDismissFeature — drawing tool -> dismiss featureSelected
//   ME:featurePickCapture — pick mode capture
// All write to: interactionModes.transitionTo(), selectionStore.clearSelection(),
//   selectionStore.setActiveTool()
```

### Seam 5: KeyboardShortcuts

```typescript
// Extracted: useKeyboardShortcuts() composable
interface KeyboardShortcutDeps {
  readonly: boolean;
  getInteractionState: () => InteractionState;
  transitionTo: (state: InteractionState) => void;
  getDesignMode: () => boolean;
  toggleDesignMode: () => void;
  undo: () => void;
  redo: () => void;
  setActiveTool: (tool: DrawTool) => void;
}
// Returns: (e: KeyboardEvent) => void  (for <svelte:window onkeydown>)
// Key mappings:
//   Escape -> transitionTo(idle) from drawRegion/pickFeature
//   Ctrl+D -> toggleDesignMode
//   Ctrl+Z / Ctrl+Shift+Z -> undo/redo
//   1/2/3 -> select/point/polygon tool
// Guard: skips INPUT/TEXTAREA/contentEditable targets
// Currently: MapEditor L419-464
```

### Seam 6: ViewportServerSave

```typescript
// Extracted: into mapStore.saveToServer(mapId) or standalone
interface ViewportSaveDeps {
  mapId: string;
  getViewportSnapshot: () => ViewportSnapshot;
  getBasemapId: () => BasemapId;
  mutateFn: (input: { id: string; viewport: ViewportSnapshot; basemap: BasemapId }) => Promise<void>;
  logActivity: (action: string) => void;
  onSuccess: () => void;
  onError: (msg: string) => void;
}
// Currently: MapEditor saveViewport() L378-398
// tRPC: trpc.maps.update.mutate({ id, viewport, basemap })
```

---

## 4. tRPC Mutation/Query Boundaries

### Queries (Read)

| Call | Component | File:Line | Store state dependency | Cache key |
|------|-----------|-----------|----------------------|-----------|
| `trpc.annotations.list.query({ mapId })` | MapEditor | MapEditor.svelte:91 | `mapId` prop | `queryKeys.annotations.list({ mapId })` |
| `trpc.features.list.query({ layerId })` | MapEditor | MapEditor.svelte:318 | `layersStore.all` (active layer) | Manual reload, not TanStack-cached |
| `trpc.features.listPaged.query(params)` | MapEditor (viewportStore) | MapEditor.svelte:158 | `layersStore.active`, `mapStore.mapInstance` (bounds) | Via viewportStore debounced fetch |
| `trpc.layers.list.query({ mapId })` | MapEditor | MapEditor.svelte:405, 875 | `mapId` prop | Manual (re-sets layersStore) |
| `trpc.shares.getForMap.query({ mapId })` | ShareDialog | ShareDialog.svelte:79 | `mapId` prop | Local state (not TanStack) |
| `trpc.collaborators.list.query({ mapId })` | ShareDialog | ShareDialog.svelte:134 | `mapId` prop | Local state |
| `trpc.annotations.getThread.query({ rootId })` | AnnotationThread | AnnotationThread.svelte:17 | Annotation selection | TanStack query |
| `trpc.annotations.fetchIiifNavPlace.query(...)` | AnnotationPanel | AnnotationPanel.svelte:625 | Annotation data | One-shot |
| `trpc.events.list.query(...)` | ActivityFeed | ActivityFeed.svelte:75 | `mapId` prop | TanStack query |

### Mutations (Write)

| Call | Component | File:Line | Triggers | Cache invalidation |
|------|-----------|-----------|----------|-------------------|
| `trpc.features.upsert.mutate(...)` | DrawingToolbar | DrawingToolbar.svelte:44 | `draw.on('finish')` | `queryClient.invalidateQueries(queryKeys.features.list({ layerId }))` |
| `trpc.features.delete.mutate(...)` | DrawingToolbar | DrawingToolbar.svelte:52 | Undo action | `queryClient.invalidateQueries(queryKeys.features.list({ layerId }))` |
| `trpc.maps.update.mutate(...)` | MapEditor | MapEditor.svelte:381 | Save viewport button | None (viewport is local-first) |
| `trpc.layers.create.mutate(...)` | LayerPanel | LayerPanel.svelte:24 | Create layer button | `layersStore.add()` (optimistic) |
| `trpc.layers.delete.mutate(...)` | LayerPanel | LayerPanel.svelte:40 | Delete layer confirm | `layersStore.remove()`, `styleStore.clearStyle()` |
| `trpc.layers.update.mutate(...)` | LayerPanel | LayerPanel.svelte:57 | Toggle visibility | `layersStore.toggle()` rollback on error |
| `trpc.layers.update.mutate(...)` | StylePanel | StylePanel.svelte:134,261,315,345 | Style changes | `layersStore.updateStyle()` + `styleStore.setStyle()` |
| `trpc.layers.reorder.mutate(...)` | LayerPanel | LayerPanel.svelte:78 | Drag reorder | `layersStore.reorder()` (optimistic) |
| `trpc.events.log.mutate(...)` | MapEditor | MapEditor.svelte:351,388,411 | Fire-and-forget | None (best-effort telemetry) |
| `trpc.shares.create.mutate(...)` | ShareDialog | ShareDialog.svelte:91 | Create share | Local state refresh |
| `trpc.shares.delete.mutate(...)` | ShareDialog | ShareDialog.svelte:108 | Delete share | Local state refresh |
| `trpc.collaborators.invite.mutate(...)` | ShareDialog | ShareDialog.svelte:150 | Invite collaborator | Local list refresh |
| `trpc.collaborators.remove.mutate(...)` | ShareDialog | ShareDialog.svelte:168 | Remove collaborator | Local list refresh |
| `trpc.annotations.create.mutate(...)` | AnnotationPanel | AnnotationPanel.svelte:491,530 | Create annotation | `queryKeys.annotations.list` invalidation |
| `trpc.annotations.delete.mutate(...)` | AnnotationPanel | AnnotationPanel.svelte:498 | Delete annotation | `queryKeys.annotations.list` invalidation |
| `trpc.annotations.update.mutate(...)` | AnnotationPanel | AnnotationPanel.svelte:522 | Edit annotation | `queryKeys.annotations.list` invalidation |
| `trpc.annotations.convertToPoint.mutate(...)` | AnnotationPanel | AnnotationPanel.svelte:539 | Convert region to point | `queryKeys.annotations.list` invalidation |

### Subscriptions

None. The map editor uses polling/manual refresh, not WebSocket subscriptions.

### Cache Invalidation Pattern

Two distinct strategies coexist:

1. **TanStack Query** (annotations, features): `createMutation` with `onSuccess` calling `queryClient.invalidateQueries()`. The shared `queryKeys` module ensures MapEditor's `annotationPinsQuery` auto-refreshes when AnnotationPanel mutates.

2. **Manual store reload** (layers): After `trpc.layers.list.query()`, the result is pushed directly into `layersStore.set()`. No TanStack caching -- each call is a fresh fetch.

**Gap**: Feature data uses a hybrid: `trpc.features.list.query()` is called directly (not via TanStack), but DrawingToolbar's mutations invalidate via TanStack `queryKeys.features.list`. This means `loadLayerData()` in MapEditor is NOT automatically triggered by DrawingToolbar's cache invalidation -- MapEditor must explicitly call `loadLayerData()` after `handleFeatureDrawn`.

---

## 5. Terra Draw Contract

### Adapter Interface

```
TerraDrawMapLibreGLAdapter({ map: MapLibreMap })
  -> TerraDraw({ adapter, modes: [...] })
```

Terra Draw is dynamically imported (`await import('terra-draw')`) in `drawingStore.init()` (drawing.svelte.ts:22-23). The adapter bridges Terra Draw's rendering to MapLibre's canvas.

### Lifecycle (drawingStore state machine)

```
idle ──init(map)──> importing ──await imports──> ready ──stop()──> stopped
  ^                    |                           |
  |                    | (gen !== _generation)      |
  |                    v                           |
  |                 [aborted, returns null]        |
  +───────────────reset()──────────────────────────+
```

**Generation counter** (`_generation`): incremented on every `init()` call. If a newer `init()` starts while the async import is in-flight, the stale init aborts by checking `gen !== _generation` (drawing.svelte.ts:26).

### Who Manages What

| Aspect | Owner | Notes |
|--------|-------|-------|
| Terra Draw instance creation | `drawingStore.init()` | Called by DrawingToolbar `$effect` (DT:initTerraDraw) |
| Mode registration | `drawingStore.init()` | Point, LineString, Polygon, Select modes hardcoded |
| Mode switching | DrawingToolbar | `draw.instance.setMode(mode)` via DT:syncToolToTerraDraw `$effect` |
| Feature capture | DrawingToolbar | `draw.on('finish', id => ...)` callback registered in DT:initTerraDraw |
| Feature snapshot | DrawingToolbar | `draw.instance.getSnapshotFeature(id)` to extract geometry |
| Feature removal from canvas | DrawingToolbar | `draw.instance.removeFeatures([id])` after save |
| In-progress cleanup | DrawingToolbar | `draw.instance.getSnapshot()` to find `drawing` state features |
| start/stop | `drawingStore` | `draw.start()` in init, `draw.stop()` in stop/reset |
| Re-init on basemap swap | DrawingToolbar | `map.on('style.load', startDraw)` -- Terra Draw sources/layers are wiped on style reload |

### Event Callbacks

| Event | Handler | Location |
|-------|---------|----------|
| `draw.on('finish', id)` | Captures drawn feature, routes to `saveFeature()`, `measureFeature()`, or `onregiondrawn()` callback | DrawingToolbar.svelte:72-104 |

Terra Draw does **not** expose `change`, `select`, or `deselect` events to the app. The only event consumed is `finish`.

### App vs Terra Draw State

| State | Managed by |
|-------|-----------|
| Active drawing mode (point/line/polygon/select) | **Both**: `selectionStore.activeTool` (app) synced to `draw.setMode()` (Terra Draw) via DT:syncToolToTerraDraw `$effect` |
| In-progress drawing vertices | **Terra Draw** only (internal canvas overlay) |
| Completed feature geometry | **App** after `getSnapshotFeature()` extracts it |
| Feature persistence | **App** via `trpc.features.upsert.mutate()` |
| Drawing canvas rendering | **Terra Draw** via MapLibre sources/layers it manages |
| Hot overlay (immediate preview for VT layers) | **App** via `hotOverlay` store |

---

## 6. MapLibre Contract

### How the App Talks to MapLibre

Three distinct access patterns:

#### Pattern A: svelte-maplibre-gl Declarative (Primary)

MapCanvas uses `svelte-maplibre-gl` components (`<MapLibre>`, `<GeoJSONSource>`, `<FillLayer>`, `<LineLayer>`, `<CircleLayer>`, `<SymbolLayer>`, `<VectorTileSource>`, `<Popup>`) in the template. State flows via props:

- `style={mapStore.basemapUrl}` -- basemap URL
- `bind:map={mapInstance}` -- binds the MapLibre instance to local state
- `center`, `zoom`, `bearing`, `pitch` -- viewport (bidirectional via bind)
- `data={layerData[layer.id]}` -- GeoJSON per source
- `paint`, `layout`, `filter` -- layer styling from `layerRenderCache`

#### Pattern B: Store-Mediated (Viewport Sync)

MapCanvas mediates between MapLibre events and `mapStore`:

```
MapLibre move event -> local $state (mapCenter, mapZoom, ...)
  -> MC:localToStore $effect -> mapStore.setViewport()     [terminal, no cycle]

mapStore.loadViewport() -> increments viewportVersion
  -> MC:storeToLocal $effect -> local $state -> library binding updates map
```

The `viewportVersion` counter (mapStore L46) is the **cycle breaker**: `MC:storeToLocal` tracks ONLY `viewportVersion`, reading center/zoom/bearing/pitch inside `untrack()`. This prevents the bidirectional sync from becoming an infinite loop.

#### Pattern C: Direct MapLibre API (Escape Hatch)

| Call | Location | Why |
|------|----------|-----|
| `map.getSource('source-${layerId}').setData(fc)` | MapEditor.svelte:327 | Bypass svelte-maplibre-gl's `firstRun` guard for immediate data push |
| `map.getStyle().layers.find(...)` | MapCanvas.svelte:172 | Find first symbol layer for sandwich ordering |
| `map.on('style.load', ...)` | MapCanvas.svelte:179, DrawingToolbar.svelte:119 | Re-init label layer ID / Terra Draw on basemap swap |
| `map.on('moveend', ...)` | MapEditor.svelte:131, viewport.svelte.ts:120 | Persist viewport to localStorage; DataTable refresh |
| `map.on('mousemove', ...)` | MapEditor.svelte:477 | Status bar cursor coordinates |
| `map.on('zoom', ...)` | MapEditor.svelte:481 | Status bar zoom level |
| `map.getBounds()` | viewport.svelte.ts:27 (via deps) | DataTable viewport-based pagination |

### Who Calls Map Methods Directly

| Caller | Direct API calls | Risk |
|--------|-----------------|------|
| **MapEditor** | `getSource().setData()`, `on('moveend')`, `on('mousemove')`, `on('zoom')` | Medium: `getSource().setData()` bypasses declarative layer, could desync |
| **MapCanvas** | `getStyle().layers`, `on('style.load')` | Low: read-only introspection |
| **DrawingToolbar** | `on('style.load')`, `isStyleLoaded()` | Low: lifecycle coordination only |
| **viewportStore** | `on('moveend')`, `getBounds()` | Low: read-only via injected dep |

### Race Condition Surface

1. **Viewport sync cycle** (MITIGATED): `viewportVersion` counter prevents MC:localToStore <-> MC:storeToLocal infinite loop. Documented in MapCanvas.svelte:109-126.

2. **Layer data push** (PARTIAL): `map.getSource().setData()` at MapEditor.svelte:327 writes directly while svelte-maplibre-gl also manages the source. The `firstRun` guard comment suggests this is a workaround -- could conflict if svelte-maplibre-gl also pushes data on the same tick.

3. **Terra Draw re-init** (MITIGATED): On basemap swap (`style.load`), MapLibre destroys all sources/layers. DrawingToolbar re-inits Terra Draw on `style.load`. Generation counter guards against stale inits.

4. **Feature click during effect flush** (MITIGATED): `handleFeatureClick` uses `queueMicrotask()` to defer state writes, avoiding Svelte 5's 1000-iteration depth limit during initial mount (MapCanvas.svelte:468-481).

5. **Multiple callers for `moveend`**: Both MapEditor (viewport localStorage persistence) and viewportStore (DataTable pagination) attach `moveend` listeners. No conflict (read-only), but cleanup must be symmetric.

---

## Appendix: Effect Block Inventory

### MapEditor (14 $effect blocks)

| Tag | Deps (tracked) | Writes to | Purpose |
|-----|----------------|-----------|---------|
| ME:mapContainerEl | `mapAreaEl` | `mapStore.setMapContainerEl()` | Sync DOM ref for export |
| ME:loadFilters | `mapId` | `loadFilters()` | One-shot filter restore |
| ME:saveFilters | `layersStore.all`, `filterStore.get()` | `saveFilters()` | Persist filters to localStorage |
| ME:viewportPersist | `mapStore.mapInstance` | `mapStore.saveViewportLocally()` via moveend | Persist viewport to localStorage |
| ME:measureActive | `activeSection`, `analysisTab`, `designMode` | `measureResult` | Clear measurement on tab switch |
| ME:sectionCleanup | `activeSection` | `interactionModes.transitionTo()` | Reset mode on sidebar change |
| ME:designModeCleanup | `designMode` | `transitionTo()`, `selectionStore` | Reset to idle on design toggle |
| ME:selectionToFeature | `selectionStore.selectedFeature`, `.selectedLayerId` | `interactionModes.transitionTo()` | Selection -> featureSelected |
| ME:toolDismissFeature | `selectionStore.activeTool` | `interactionModes.transitionTo()` | Drawing tool -> dismiss selection |
| ME:featurePickCapture | `selectionStore.selectedFeature`, `.selectedLayerId` | `interactionModes.transitionTo()` | Pick mode -> capture feature |
| ME:initLayers | `initialLayers` | `layersStore.set()`, `loadLayerData()` | Bootstrap layer data |
| ME:viewportLoading | `mapStore.mapInstance`, `layersStore.active` | viewportStore | Large-layer viewport pagination |
| ME:hotOverlayCleanup | (none, cleanup only) | `hotOverlay.clearHotFeatures()` | Unmount cleanup |
| ME:statusBar | `mapStore.mapInstance` | `cursorLat`, `cursorLng`, `currentZoom` | Cursor/zoom tracking |

### MapCanvas (4 $effect blocks)

| Tag | Deps | Writes to | Purpose |
|-----|------|-----------|---------|
| MC:syncMapInstance | `mapInstance` | `mapStore.setMapInstance()` | Push map ref to global store |
| MC:storeToLocal | `mapStore.viewportVersion` | local `mapCenter`, `mapZoom`, `mapBearing`, `mapPitch` | Programmatic viewport changes |
| MC:localToStore | `mapCenter`, `mapZoom` | `mapStore.setViewport()` | User pan/zoom -> store |
| MC:firstLabelLayer | `mapInstance` | `firstLabelLayerId` | Basemap label layer discovery |

### DrawingToolbar (3 $effect blocks)

| Tag | Deps | Writes to | Purpose |
|-----|------|-----------|---------|
| DT:initTerraDraw | `map` prop | `drawingStore.init()`, event handlers | Terra Draw lifecycle |
| DT:syncToolToTerraDraw | `selectionStore.activeTool`, `drawingStore.isReady` | `draw.setMode()` | Sync app tool to Terra Draw mode |
| (unnamed cleanup) | `map` prop | `drawingStore.stop()` | Cleanup on unmount |

---

## Proposed Seeds

```json
[
  {
    "title": "Extract InteractionModeBridge composable from MapEditor",
    "type": "task",
    "priority": "medium",
    "labels": ["decomposition", "map-editor", "contracts"],
    "description": "5 $effect blocks (ME:sectionCleanup, ME:designModeCleanup, ME:selectionToFeature, ME:toolDismissFeature, ME:featurePickCapture) all orchestrate interactionModes.transitionTo() from MapEditor. Extract into useInteractionOrchestrator() composable per decomposition.md seam 4. Props contract defined in contracts.md section 3."
  },
  {
    "title": "Resolve feature data cache invalidation gap",
    "type": "bug",
    "priority": "high",
    "labels": ["data-integrity", "map-editor", "contracts"],
    "description": "DrawingToolbar invalidates TanStack queryKeys.features.list after upsert/delete, but MapEditor's loadLayerData() does NOT use TanStack — it calls trpc.features.list.query() directly. This means cache invalidation from DrawingToolbar does not trigger a data reload in MapEditor. Currently works because handleFeatureDrawn() explicitly calls loadLayerData(), but this is a fragile coupling. Unify on one cache strategy."
  },
  {
    "title": "Audit direct MapLibre getSource().setData() bypass",
    "type": "task",
    "priority": "medium",
    "labels": ["tech-debt", "map-editor", "contracts"],
    "description": "MapEditor.svelte:327 calls map.getSource().setData() directly to bypass svelte-maplibre-gl's firstRun guard. This creates a dual-write path (declarative via GeoJSONSource data prop + imperative via setData). Investigate whether svelte-maplibre-gl has been updated to handle this case, or document the invariant that the direct call must always run AFTER the declarative source is registered."
  },
  {
    "title": "Extract KeyboardShortcuts composable from MapEditor",
    "type": "task",
    "priority": "low",
    "labels": ["decomposition", "map-editor", "contracts"],
    "description": "handleKeydown (MapEditor L419-464) reads from undoStore, selectionStore, interactionModes, and designMode. Clean extraction boundary defined in contracts.md section 3 seam 5. Zero risk — no store writes beyond what deps interface exposes."
  },
  {
    "title": "Eliminate god-component store write leaks in MapEditor",
    "type": "task",
    "priority": "medium",
    "labels": ["decomposition", "map-editor", "contracts"],
    "description": "MapEditor writes to selectionStore.setActiveTool() (keyboard shortcuts), hotOverlay.clearHotFeatures() (unmount), and layersStore.set() (import complete) — all of which conceptually belong to child components. These writes should move to the extracted composables (KeyboardShortcuts, LayerDataManager) per the decomposition plan."
  }
]
```

**See also:** [components](components.md) | [behavior](behavior.md) | [decomposition](decomposition.md)
