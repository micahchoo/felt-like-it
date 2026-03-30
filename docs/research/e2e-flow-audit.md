# FLI E2E Flow Audit — Reference Repo Comparison

> Audit date: 2026-03-30 | Research only, no code changes.

---

## Flow 1: Map Creation

**Trigger:** User clicks "New Map" on dashboard
**Outcome:** Empty editor opens with basemap at world zoom

### Current Implementation

- `apps/web/src/routes/(app)/dashboard/+page.server.ts:18-95` — `load()` fetches user's maps, layer counts, shared maps, and templates. Returns to page as `PageData`.
- `apps/web/src/routes/(app)/dashboard/+page.server.ts:98-104` — Form action `createMap` calls `createMap(userId, title)` then `redirect(302, /map/{id})`.
- `apps/web/src/routes/(app)/dashboard/+page.svelte:52-59` — `actions.onCreate` calls `trpc.maps.create.mutate({title})` then `goto(/map/{id})`. This is the **client-side path** (tRPC, not form action).
- `apps/web/src/lib/screens/DashboardScreen.svelte:26-34` — `handleCreate(title)` guards double-submit with `creatingMap` flag, delegates to `actions.onCreate`.
- `apps/web/src/lib/server/maps/operations.ts:17-45` — `createMap()` inserts into `maps` table with just `userId`, `title`, `description`. No default layers created. Appends audit log.
- `apps/web/src/routes/(app)/map/[id]/+page.server.ts:6-38` — `load()` fetches map + layers + collaborator role. Returns to page.
- `apps/web/src/routes/(app)/map/[id]/+page.svelte:10-18` — Derives `MapEditorData` from `PageData`, passes to `MapEditorScreen`.
- `apps/web/src/lib/screens/MapEditorScreen.svelte:21-25` — `onMount` loads viewport from localStorage (or falls back to map's stored viewport), sets basemap.

### Reference Patterns

- **svelte-maplibre:** Not applicable (component library, no session/creation flow).
- **Allmaps:** `apps/editor/src/routes/(homepage)/+page.svelte:25-29` — No DB creation. User pastes a IIIF URL, `handleInputSubmit` calls `gotoRoute()` which navigates to `(views)/images` with URL params. Session state is entirely URL-driven (no server-side persistence for map creation). The `(views)/+layout.svelte` initializes ~12 state objects (`SourceState`, `MapsState`, `UiState`, etc.) from URL params on layout mount. This is a fundamentally different model: URL-as-state vs DB-as-state.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | **Dual creation paths**: Form actions (`createMap` action at line 98) and tRPC (`trpc.maps.create` at page.svelte:54) both create maps. Dashboard uses tRPC exclusively; form action is dead code. | Remove form actions or consolidate to one path. |
| gap | **No default layer on creation**: `createMap()` creates a bare map with no layers. User lands on an empty editor with no affordance to add data. Allmaps creates state lazily from URL. | Consider creating a default empty layer on map creation, or show an onboarding prompt. |
| debt | **No viewport on creation**: `createMap()` does not set an explicit viewport. The map schema's default is `{center:[0,0], zoom:2}`. `MapEditorScreen.onMount` checks localStorage first, then falls back to DB viewport. First-time map always gets world view. | Intentional for a blank map; document as design choice or let user pick a starting location. |
| missing | **No loading state during creation**: `handleCreate` sets `creatingMap=true` but `DashboardScreen` has no spinner on the "New Map" button — just a disabled guard. | Add visual feedback (spinner/disabled state) on the create button. |
| gap | **No title input dialog**: `handleCreate('New Map')` hard-codes the title. The `onCreate` action accepts a title parameter but the UI never prompts the user. | Add a title input dialog or inline rename on the dashboard card. |

---

## Flow 2: Layer Rendering

**Trigger:** Layer data loaded from DB/API
**Outcome:** GeoJSON or VectorTile source with Fill+Line+Circle sublayers visible on map

### Current Implementation

- `apps/web/src/lib/components/map/MapCanvas.svelte:4` — Imports `MapLibre, GeoJSONSource, VectorTileSource, CircleLayer, LineLayer, FillLayer, SymbolLayer, Popup` from `svelte-maplibre-gl`. FLI **already uses** the declarative svelte-maplibre-gl library.
- `MapCanvas.svelte:~230-290` (layerRenderCache) — `$derived.by` computes a `Record<string, LayerRenderCache>` that pre-builds all paint/layout/filter objects per layer. Critical comment at line ~280: without this cache, function calls in the template create new object references per evaluation, causing infinite re-render loops with svelte-maplibre-gl's reference comparison.
- `MapCanvas.svelte:~200-230` (usesVectorTiles, martinTileUrl, getVectorTileFilter) — Routing logic: layers above `VECTOR_TILE_THRESHOLD` features use Martin vector tiles; below use GeoJSON source.
- `MapCanvas.svelte:~480-560` (each loop) — `{#each layersStore.all as layer}` iterates visible layers. For VT layers: `<VectorTileSource>` with `<FillLayer>`, `<LineLayer>`, `<CircleLayer>`, `<SymbolLayer>`. For GeoJSON: `<GeoJSONSource>` with same sublayer set. Each sublayer gets `onclick` handler that calls `handleFeatureClick`.
- `MapCanvas.svelte:~560-600` (hot overlay loop) — Second `{#each}` renders recently-drawn features as GeoJSON overlay for VT layers (instant feedback before tile rebuild).
- `apps/web/src/lib/components/map/map-styles.ts:1-49` — `getLayerPaint()` is pure: extracts `style.paint`, resolves FSL interpolators, filters by prefix (`circle-`, `line-`, `fill-`), falls back to `PAINT_DEFAULTS`.
- `map-styles.ts:59-90` — `applyHighlight()` wraps primary color in a MapLibre `case` expression for selected feature highlight.

### Reference Patterns

- **svelte-maplibre:** `src/lib/GeoJSON.svelte` — Declarative `<GeoJSON data={...}>` component uses Svelte context (`updatedSourceContext`) to auto-wire child layers to the correct source. `src/lib/FillLayer.svelte` — Thin wrapper that passes `paint`, `layout`, `manageHoverState`, `hovered` (bindable), `eventsIfTopMost`, `hoverCursor` as props to `Layer.svelte`. `src/lib/Layer.svelte` — Core component: adds layer via `map.addLayer(flush({id, type, source, paint, layout, filter, ...}))`, handles click/hover/mousemove events, manages hover feature state via `map.setFeatureState`. Uses `diffApplier` for efficient paint/layout updates (compares by key, not reference).
- **Allmaps:** `apps/editor/src/lib/components/views/Georeference.svelte` — Does not use svelte-maplibre-gl. Creates raw `MapLibreMap` instances imperatively and manages layers via Terra Draw only (GCP points, no data layers).

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| debt | **TYPE_DEBT on every sublayer**: Comments at ~line 475 acknowledge that paint casts (`as unknown as NonNullable<FillLayerSpecification['paint']>`) are needed because the dynamic paint builders return `Record<string,unknown>`. | Type the paint builders to return proper MapLibre spec types (FillLayerSpecification['paint'], etc.) — eliminates all casts. |
| gap | **No hover state management**: FLI's sublayers have `onclick` handlers but no `manageHoverState`, `hoverCursor`, or `eventsIfTopMost` props. svelte-maplibre's Layer.svelte has built-in hover state management via `map.setFeatureState({hover: true/false})` — FLI doesn't use any of it. | Add `manageHoverState` and `hoverCursor="pointer"` to clickable sublayers. This gives free hover highlighting via feature-state without custom code. |
| gap | **No eventsIfTopMost**: When layers overlap, clicking fires handlers for every layer under the cursor. FLI manually deduplicates with a 300ms timestamp guard (`CLICK_DEDUP_MS`). svelte-maplibre's `eventsIfTopMost` prop handles this declaratively by checking `eventTopMost(e) !== layer.value`. | Use `eventsIfTopMost={true}` on clickable sublayers instead of the timestamp dedup hack. |
| gap | **Triple onclick duplication per layer**: Each of the 3 sublayers (Fill, Line, Circle) in both VT and GeoJSON branches has an identical `onclick` handler. That's 6 copies of the same click logic per layer iteration. | Extract a shared `handleLayerClick(lrc)` function that returns the onclick handler, or use svelte-maplibre's `<Popup>` nested inside `<Layer>` pattern to eliminate manual click handling. |
| gap | **No z-ordering via beforeLayerType**: Only the sandwiched fill layer uses `beforeId`. svelte-maplibre supports `beforeLayerType` for z-ordering relative to layer types (e.g., render fills below labels). | Consider `beforeLayerType="symbol"` on fill/line layers to ensure data renders below map labels. |
| debt | **887-line monolith**: MapCanvas handles rendering, click handling, annotation pins, annotation regions, badges, measurement annotations, hot overlays, popup management, and drawing toolbar mounting. | Decompose: extract annotation layers, measurement layers, and hot overlay into child components that compose inside `<MapLibre>`. |
| gap | **No `$effect`-based paint diffing**: FLI solved the infinite-loop problem with a `$derived.by` cache. svelte-maplibre-gl's `Layer.svelte` uses `diffApplier` (key-by-key comparison) instead of reference equality. The cache is correct but adds complexity. | The cache approach is sound. Document why it exists (the comment is good) and ensure it stays in sync with layersStore changes. |

---

## Flow 3: Feature Interaction

**Trigger:** User clicks/hovers a feature on the map
**Outcome:** Popup appears at click location showing feature properties; feature is highlighted

### Current Implementation

- `MapCanvas.svelte:~370-400` (handleFeatureClick) — Guards: blocks during active draw tools (`point`/`line`/`polygon`). Deduplicates mobile taps with 300ms window. Defers to `queueMicrotask` to avoid exceeding Svelte 5's 1000-iteration depth limit during initial effect flush. Inside microtask: sets `selectedLayerStyle` and calls `editorState.selectFeature(feature, coords, layerId)`.
- `apps/web/src/lib/stores/map-editor-state.svelte.ts:102-115` (selectFeature) — Atomic state update: sets `#selectedFeature`, `#selectedFeatureIds`, `#popupCoords`, `#selectedLayerId`, and transitions `#interactionState` to `featureSelected` (or updates `pickFeature` if in pick mode).
- `MapCanvas.svelte:~620-630` (Popup rendering) — `{#if editorState.selectedFeature && editorState.popupCoords}` renders `<Popup lnglat={...} closeButton={true} onclose={clearSelection}>` with `<FeaturePopup>` inside.
- `apps/web/src/lib/components/map/FeaturePopup.svelte:1-50` — Props: `feature`, `style?`, `onclose?`, `oneditattributes?`. Derives `propEntries` from `feature.properties`, respecting `style.popup.keyAttributes` ordering. Shows geometry type badge, title from `style.popup.titleAttribute`, formatted property values.
- `map-editor-state.svelte.ts:82-100` (transitionTo) — State machine with 5 states: `idle`, `featureSelected`, `drawRegion`, `pickFeature`, `pendingMeasurement`. Transitions sync the active tool.
- `map-editor-state.svelte.ts:~55-60` — All interaction state is private `$state` fields with public getters. No direct mutation from outside the class.

### Reference Patterns

- **svelte-maplibre:** `src/lib/Layer.svelte:100-200` — Built-in hover management: `handleMouseEnter` sets `hovered = features[0]`, `handleMouseMove` tracks `hoverFeatureId` and calls `map.setFeatureState({hover: true/false})` to toggle MapLibre's feature state. `handleMouseLeave` clears both. The `hovered` prop is `$bindable()` — parent can react to hover changes. `eventsIfTopMost` checks `eventTopMost(e)` to suppress events from lower layers. `src/lib/Popup.svelte:20-90` — Popup component with `openOn` prop (`'hover'|'click'|'dblclick'|'contextmenu'|'manual'`), `openIfTopMost`, `canOpen` callback, `closeOnClickOutside`, `closeOnMove`. Renders children snippet with `{features, data, map, close, isOpen}` context. Nests inside `<Layer>` to auto-bind to layer events.
- **Allmaps:** `Georeference.svelte:~400-460` — GCP interaction is via Terra Draw events, not MapLibre feature events. Click on map → `handleGcpCreated`/`handleGcpDeleted` via Terra Draw finish/delete events. No popup — GCP list panel shows selection.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | **No hover feedback at all**: FLI has zero hover handling on data layers. No cursor change, no visual highlight, no hover state. svelte-maplibre provides this for free with `manageHoverState` + paint expressions using `['case', ['boolean', ['feature-state', 'hover'], false], hoverColor, normalColor]`. | Add `manageHoverState={true}` and `hoverCursor="pointer"` to clickable sublayers. Add hover-aware paint expressions (e.g., brighter fill-opacity on hover). |
| gap | **Popup is not composable**: FLI's popup is rendered at the `<MapLibre>` level (`{#if selectedFeature && popupCoords}`) rather than nested inside layers. svelte-maplibre's pattern is `<FillLayer><Popup openOn="click">...</Popup></FillLayer>` — the popup auto-binds to layer click events and gets features from the event. | Consider nesting `<Popup>` inside each clickable layer to eliminate manual `handleFeatureClick` → `editorState.selectFeature` → conditional render chain. |
| debt | **queueMicrotask workaround**: The comment explains this is needed because MapLibre click handlers fire during Svelte's effect flush. This is a real Svelte 5 issue — the workaround is correct but fragile. | Document as a known Svelte 5 + MapLibre integration issue. The workaround is sound; a better fix would require svelte-maplibre-gl to batch event dispatch. |
| gap | **No keyboard accessibility for selection**: Features can only be selected by click/tap. No keyboard navigation between features, no focus management after selection. | Consider adding arrow-key navigation between features when a layer is focused, or at minimum ensure the popup is keyboard-dismissible (Escape already works via `useKeyboardShortcuts`). |
| missing | **No hover tooltip (for data features)**: Annotation pins have a hover tooltip (`hoveredAnnotation`), but regular data features do not. User must click to see any information. | Add a lightweight hover preview using svelte-maplibre's `<Popup openOn="hover">` nested in data layers. |
| gap | **Highlight is paint-based, not feature-state-based**: `applyHighlight()` wraps the entire paint property in a `case` expression comparing feature ID. This means the paint object changes (and MapLibre re-evaluates) whenever selection changes. Feature-state-based highlighting (svelte-maplibre's `manageHoverState` approach) only toggles state on the specific feature — much cheaper. | Migrate to feature-state-based highlight: `['case', ['boolean', ['feature-state', 'selected'], false], highlightColor, normalColor]` and call `map.setFeatureState()` on select/deselect. |

---

## Flow 4: Drawing

**Trigger:** User picks a drawing tool (point/line/polygon) from toolbar
**Outcome:** User draws on map, feature saved to PostGIS via tRPC

### Current Implementation

- `apps/web/src/lib/components/map/DrawingToolbar.svelte:1-36` — Props: `map`, `onfeaturedrawn?`, `onmeasured?`, `onregiondrawn?`. Gets `editorState` from context, creates `featureUpsertMutation` and `featureDeleteMutation` via tRPC + tanstack-query.
- `DrawingToolbar.svelte:~60-110` (Terra Draw init) — `$effect` initializes Terra Draw on mount: `terraDrawInit(map).then(draw => { draw.on('finish', async (id) => {...}) })`. The finish handler has three modes: (1) annotation region → `onregiondrawn(geometry)`, (2) measurement → `measureFeature(f)`, (3) normal → `saveFeature(f)`.
- `DrawingToolbar.svelte:~130-200` (saveFeature) — Calls `featureUpsertMutation.mutateAsync({layerId, features: [{geometry, properties}]})`. On success: adds to `hotOverlay` for instant VT feedback, pushes undo command. Undo calls `featureDeleteMutation.mutateAsync`, redo re-upserts.
- `DrawingToolbar.svelte:~100-110` (post-save cleanup) — Removes drawn feature from Terra Draw overlay (`drawingInstance.removeFeatures([id])`), resets to select mode.
- `apps/web/src/lib/stores/undo.svelte.ts:1-44` — Simple command-pattern undo stack. `MAX_HISTORY=50`. `push(command)` clears redo stack. `undo()`/`redo()` are async (commands can be async). `clear()` resets both stacks.
- `apps/web/src/lib/components/map/DrawActionRow.svelte:1-50` — Post-draw action row with "Annotate", "Measure", "Done" buttons. Auto-dismisses after 8 seconds via `setTimeout`.
- `map-editor-state.svelte.ts:60-62` — `#drawingState` tracks `{status: 'idle'|'initializing'|'ready'|'error'}` and `#drawingGeneration` for lifecycle tracking.

### Reference Patterns

- **svelte-maplibre:** `src/routes/examples/draw/+page.svelte` — Uses `@mapbox/mapbox-gl-draw` (not Terra Draw). Integration is imperative: creates a `MapboxDraw` instance, patches CSS classes for MapLibre compatibility, adds as a map control via `map.addControl(draw)`. No undo, no persistence, no mode management — just a demo.
- **Allmaps:** `apps/editor/src/lib/components/views/Georeference.svelte:1-8,96-97` — Uses `TerraDraw` + `TerraDrawPointMode` + `TerraDrawMapLibreGLAdapter`. Creates **two** TerraDraw instances: `resourceDraw` (image-space points) and `geoDraw` (geo-space points). Both are point-only. GCP lifecycle is event-driven: `draw.on('finish', handleGcpCreated)`, `draw.on('change', handleGcpMoved)`, `draw.on('delete', handleGcpDeleted)`. State is managed via ShareDB (real-time collaborative OT). The dual-pane architecture (resource image + geo map) is unique to georeferencing.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | **No optimistic UI on draw**: `saveFeature()` awaits the tRPC mutation before adding to `hotOverlay`. The feature disappears from Terra Draw's overlay immediately after draw, then reappears after the server round-trip (or after query invalidation). | Add to `hotOverlay` immediately (optimistic), then replace with server-confirmed feature. Roll back on error. |
| gap | **DrawActionRow auto-dismiss is aggressive**: 8-second timeout auto-hides "Annotate"/"Measure"/"Done" regardless of user intent. If user is deciding, options vanish. | Extend timeout or keep visible until user acts, with a subtle fade-to-remind animation. |
| debt | **Terra Draw init is fire-and-forget**: `terraDrawInit(map).then(...)` with a `.catch(console.error)`. If init fails (e.g., WebGL context lost), `drawingInstance` stays null and the toolbar shows tools that silently don't work. | Surface init failure to the user (toast or disabled state on toolbar buttons). The `drawingState.status = 'error'` path exists but may not be connected to visible UI. |
| gap | **Undo stack is global singleton**: `undoStore` is a module-level singleton. If two maps were ever open simultaneously (e.g., in separate tabs sharing state), undo commands would cross-contaminate. | Scope undo stack per map ID, or clear on map change (currently `clear()` exists but call sites should be audited). |
| missing | **No redo keyboard shortcut visible**: `undoStore` supports redo, but keyboard shortcut binding (`Ctrl+Shift+Z` or `Ctrl+Y`) is not visible in DrawingToolbar. | Verify redo shortcut exists in `useKeyboardShortcuts` and surface it in the toolbar tooltip. |
| gap | **No drawing validation**: `saveFeature()` sends any geometry the user drew directly to the server. No client-side validation for self-intersecting polygons, zero-area polygons, or duplicate points. | Add client-side geometry validation (e.g., via `@turf/boolean-valid` or a custom check) before upserting. |
| gap | **Allmaps pattern: dual-context drawing not applicable but event architecture is**: Allmaps' Terra Draw integration uses strongly-typed events (`InsertGcpEvent`, `ReplaceGcpEvent`, `RemoveGcpEvent`) with explicit handler functions per event type. FLI uses a single `finish` handler with conditional branches. | Consider typed draw events (e.g., `DrawFeatureEvent`, `DeleteFeatureEvent`) for better traceability and testability. |

---

## Cross-Cutting Observations

| Category | Finding | Recommendation |
|----------|---------|----------------|
| architecture | **FLI already uses svelte-maplibre-gl declaratively** — it imports and uses `<MapLibre>`, `<GeoJSONSource>`, `<FillLayer>` etc. The gap is that it doesn't use the library's *interaction primitives* (`manageHoverState`, `eventsIfTopMost`, nested `<Popup>`, `hoverCursor`). | Adopt svelte-maplibre-gl's interaction model — it would eliminate ~100 lines of manual click/hover/dedup code. |
| architecture | **Allmaps' URL-as-state model** is architecturally different from FLI's DB-as-state model. The main transferable pattern is Allmaps' state initialization in the views layout (`(views)/+layout.svelte` creates ~12 state objects). FLI does something similar with `mapStore`, `layersStore`, `editorState`, but spread across `MapEditorScreen.onMount` and context providers. | Consider a layout-level state initialization pattern (like Allmaps) where all editor state is created in one place. |
| architecture | **MapCanvas (887 lines) is the core bottleneck** for all four flows. Every rendering, interaction, annotation, measurement, and drawing concern passes through it. | Decompose MapCanvas into: (1) DataLayers (rendering loop), (2) AnnotationLayers (pins, regions, badges), (3) MeasurementLayers, (4) InteractionManager (click/hover/popup). Each can be a svelte-maplibre-gl child inside `<MapLibre>`. |
| debt | **TYPE_DEBT markers**: 3 instances in MapCanvas (paint casts, annotation collection cast), 1 in DashboardScreen (lucide-svelte type). All are documented with reasons. | Track in seeds as tech debt; the paint casts can be fixed by typing the paint builder return types. |
