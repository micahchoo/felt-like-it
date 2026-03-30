# E2E Flow Audit: Flows 9-12

> Audit date: 2026-03-30
> Reference repos: svelte-maplibre, allmaps

---

## Flow 9: Measurement

**Trigger:** User navigates to Analysis tab > Measure sub-tab in the SidePanel
**Outcome:** Drawing toolbar enters measurement mode; drawn line/polygon produces floating stats panel with distance/area/perimeter and unit conversion

### Current Implementation

- `MapEditor.svelte:141` — `measureResult` state variable holds the current `MeasurementResult | null`
- `MapEditor.svelte:158` — `activeSection` defaults to `'annotations'`; SidePanel has 3 sections: annotations, analysis, activity
- `MapEditor.svelte:167` — `measureActive` derived: true when `activeSection === 'analysis' && analysisTab === 'measure' && !designMode`
- `MapEditor.svelte:171` — Clearing: when `measureActive` goes false, `measureResult` is reset to null
- `MapEditor.svelte:498` — Conditionally passes `onmeasured` callback to `MapCanvas` only when `measureActive` is true
- `MapEditor.svelte:544-546` — Also supports measuring a selected feature's geometry directly via `measureLine`/`measurePolygon`
- `MapEditor.svelte:669-676` — `MeasurementPanel` rendered inside a SidePanel snippet with `onclear` and `onsaveasannotation` callbacks
- `DrawingToolbar.svelte:23-27` — When `onmeasured` is provided, drawn features are NOT saved to any layer; measurement result is computed and passed to callback
- `DrawingToolbar.svelte:92-94` — `measureFeature(f)` called on finish when in measurement mode
- `MeasurementPanel.svelte:1-26` — Defines `SaveAsAnnotationPayload` interface bridging measurement to annotation system
- `MeasurementPanel.svelte:57-95` — Displays distance (total + segments/nodes) or area (area + perimeter + nodes) in stat cards with unit selectors
- `MeasurementPanel.svelte:77-90` — Unit toggle buttons for distance (`km/mi/m/ft`) and area (`km2/mi2/ha/ac/m2`)
- `packages/geo-engine/src/measurement.ts:1-157` — Core measurement logic using `@turf/turf`: `measureLine` (geodesic path length), `measurePolygon` (area + perimeter), `formatDistance`, `formatArea` with locale-aware formatting
- `packages/geo-engine/src/measurement.ts:17-35` — Typed unit enums `DistanceUnit` and `AreaUnit` with ordered arrays for UI selectors
- `packages/geo-engine/src/measurement.ts:39-58` — `DistanceMeasurement` and `AreaMeasurement` result types with readonly geometry coordinates

### Reference Patterns

- **svelte-maplibre:** No built-in measurement. Its `Popup.svelte:19-67` offers declarative `openOn`/`lngLat`/`offset`/`anchor` props for positioning floating content near map features. Pattern: popup lifecycle managed via Svelte reactivity rather than imperative MapLibre API calls. FLI's MeasurementPanel is a fixed side panel, not a map-positioned popup.
- **Allmaps:** Viewer controls at `apps/viewer/src/lib/components/controls/` use modular single-purpose components (Map.svelte, View.svelte, Selection.svelte, Dials.svelte, Transformation.svelte). Each control has its own dedicated store (opacity.ts, grid.ts, distortion.ts, transformation.ts). The store-per-control pattern contrasts with FLI's approach where measurement state lives inside `MapEditor.svelte` as local reactive variables.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | MeasurementPanel is fixed in SidePanel; no option to show results as a floating tooltip near the drawn geometry on the map | Consider a secondary inline popup (svelte-maplibre Popup pattern) positioned at the midpoint/centroid of the measurement geometry |
| debt | `measureResult` state, `measureActive` derived, `analysisTab`, and the measurement↔annotation bridge all live as local vars in the 700+ line MapEditor.svelte | Extract a `createMeasurementStore()` (Allmaps pattern: one store per concern) to isolate measurement lifecycle |
| gap | No segment-by-segment breakdown; only total distance and node/segment counts shown | Add per-segment distances to the stat panel (data already available in `coordinates`) |
| missing | No keyboard shortcut to toggle measurement mode on/off | Add a shortcut (e.g., `M`) in `useKeyboardShortcuts.svelte.js` |
| gap | "Save as annotation" bridges measurement→annotation via a `SaveAsAnnotationPayload`, but this triggers a full panel switch (`activeSection = 'annotations'`), losing the measurement context | Allow saving without leaving the measurement panel; use optimistic mutation |

---

## Flow 10: Annotations

**Trigger:** User selects anchor type (point/region/viewport/feature) and places annotation on map, then fills content editor
**Outcome:** Annotation saved via tRPC, rendered as amber pin/region/badge on map, threaded replies supported

### Current Implementation

- `AnnotationPanel.svelte:16-49` — Props include `onrequestregion`, `onrequestfeaturepick`, `regionGeometry`, `pickedFeature`, `pendingMeasurement`, `scrollToFeatureId`
- `AnnotationPanel.svelte:57-61` — Annotation list via TanStack Query: `queryKeys.annotations.list({ mapId })`
- `AnnotationPanel.svelte:288` — `formAnchorType` state: `'point' | 'region' | 'viewport' | 'feature'`
- `AnnotationPanel.svelte:489-491` — `createAnnotationMutation`: tRPC `annotations.create.mutate` with input `{ mapId, anchor: Anchor, content: { kind: 'single', body: AC } }`
- `AnnotationPanel.svelte:498` — Delete mutation: `trpc.annotations.delete.mutate`
- `AnnotationPanel.svelte:521` — Update mutation with `content`, `anchor`, `version` (optimistic concurrency)
- `AnnotationPanel.svelte:529-530` — Reply mutation: `trpc.annotations.create.mutate` with `parentId`
- `AnnotationPanel.svelte:538` — Move annotation mutation: `trpc.annotations.move.mutate` with `coordinates`
- `AnnotationPanel.svelte:548-590` — `handleCreate`: validates form, uploads image blob if needed, constructs anchor from `formAnchorType` + geometry, calls `createAnnotationMutation`
- `AnnotationPanel.svelte:643-648` — Orphaned feature annotations: auto-convert to point anchor when feature is deleted
- `AnnotationContent.svelte:2` — Renders 7 content types exhaustively: text/emoji/gif/image/link/iiif/measurement
- `AnnotationContent.svelte:41-44` — Handles both raw `AnnotationContent` (legacy) and `AnnotationObjectContent` wrapper (single/slotted)
- `AnnotationContent.svelte:65-76` — Anchor type badges: point (amber), region (primary), feature (emerald), measurement (cyan), viewport (map emoji)
- `AnnotationThread.svelte` — Thread display with replies (compact component, ~60 lines)
- `annotation-geo.svelte.ts:59-77` — `deriveAnnotationPins`: filters `anchor.type === 'point'`, builds GeoJSON FeatureCollection with embedded `contentJson` in properties
- `annotation-geo.svelte.ts:80-97` — `deriveAnnotationRegions`: filters `anchor.type === 'region'`, builds polygon FeatureCollection
- `annotation-geo.svelte.ts:103-114` — `deriveAnnotatedFeaturesIndex`: builds Map of featureId→{layerId, count} for badge overlay
- `annotation-geo.svelte.ts:120-135` — `deriveMeasurementData`: builds measurement geometry FeatureCollection with labels
- `annotation-geo.svelte.ts:139-146` — `createAnnotationGeoStore`: reactive factory with `.pins`, `.regions`, `.index`, `.measurements` getters
- `MapCanvas.svelte:37-55` — Annotation pin GeoJSON interface with `contentJson` serialized in properties for popup rendering without extra fetch
- `MapCanvas.svelte:62-72` — Annotation region interface (Polygon features)
- `MapCanvas.svelte:811-835` — Measurement annotation rendering: GeoJSON source + line/fill/outline/label layers
- `MapCanvas.svelte:883` — DrawingToolbar receives `onmeasured` when in measurement mode
- `MapEditor.svelte:29` — `createAnnotationGeoStore` instantiated from query cache
- `MapEditor.svelte:80-84` — Annotation pins query shared with AnnotationPanel via TanStack Query cache
- `map-editor-state.svelte.ts:25-26` — InteractionState includes `drawRegion` and `pickFeature` for annotation placement modes
- `map-editor-state.svelte.ts:27-36` — `pendingMeasurement` interaction state for measurement-to-annotation bridge

### Reference Patterns

- **Allmaps `@allmaps/annotation`:** Sophisticated annotation handling with versioned schemas (`Annotation0Schema`, `Annotation1Schema`, `AnnotationPage0Schema`, `AnnotationPage1Schema`). `validator.ts:38-65` — `validateAnnotation()` auto-detects version and normalizes to latest (`toAnnotation1`). `parser.ts:27-160` — `parseAnnotation()` extracts structured data (resource, GCPs, masks, transformations) from W3C annotations. `generator.js` produces annotations. This is a full parse/validate/generate/version-migrate pipeline for IIIF Georeference Annotations.
- **Allmaps editor georeference:** `apps/editor/src/routes/(views)/georeference/+page.svelte` — thin route page that delegates to `Georeference.svelte` component. The annotation placement flow lives in the component, not the route.
- **svelte-maplibre:** No annotation system, but its `Popup.svelte` pattern of rendering Svelte snippet children inside a map-positioned popup is relevant for annotation content display.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | No annotation schema versioning or migration. Content is `{ kind: 'single', body: AC }` stored directly; no version field on the content envelope | Add a `version` field to the annotation content schema (Allmaps pattern: multi-version schemas + normalizer) |
| debt | AnnotationPanel.svelte is ~1200 lines with form state, 6 mutations, blob upload, anchor placement, thread rendering, and list management in one file | Split into AnnotationForm, AnnotationList, AnnotationMutations (hooks), and BlobUpload modules |
| gap | `contentJson` is serialized as a JSON string into GeoJSON feature properties for popup rendering (`MapCanvas.svelte:44`). This avoids an extra fetch but means annotation content is duplicated in memory and parsed on every popup click | Consider a lightweight annotation popup store keyed by ID, populated on first click from the TanStack Query cache |
| missing | No offline/optimistic create. `handleCreate` awaits the mutation before the annotation appears on the map | Add optimistic update to TanStack Query cache so the pin appears immediately |
| gap | `formAnchorType` supports point/region/viewport/feature but the Allmaps-style IIIF anchor type (linking to a IIIF resource region) is not exposed as a first-class anchor despite IIIF being a supported content type | Surface IIIF resource anchoring if IIIF annotations are a product goal |
| debt | The measurement-to-annotation bridge uses a `pendingMeasurement` prop threaded through MapEditor→AnnotationPanel with a matching `InteractionState` variant. This cross-cutting concern spans 3 files | Centralize in a shared annotation-draft store that both MeasurementPanel and AnnotationPanel can read/write |

---

## Flow 11: Export

**Trigger:** User clicks Export icon in left rail or toolbar button, selects layer and format
**Outcome:** Browser download of GeoJSON/GeoPackage/Shapefile, or server-generated PDF; also supports PNG screenshot and annotation GeoJSON export

### Current Implementation

- `MapEditor.svelte:152` — Export dialog button in left icon rail at line ~152: `dialogs.showExportDialog = true`
- `MapEditor.svelte:17` — `ExportDialog` imported from `$lib/components/data/ExportDialog.svelte`
- `ExportDialog.svelte:1-15` — Props: `layers`, `mapId`, `open` (bindable)
- `ExportDialog.svelte:17-19` — `selectedLayerId` state, defaults to first layer
- `ExportDialog.svelte:22-27` — Individual loading states per format: `exportingGeoJSON`, `exportingGpkg`, `exportingShp`, `exportingPdf`, `exportingPNG`, `exportingAnnotations`
- `ExportDialog.svelte:29-39` — `waitForTiles()`: waits for map `idle` event before screenshot capture (max 10s timeout)
- `ExportDialog.svelte:42-58` — `downloadLayer(format, extension)`: generic fetch to `/api/export/${selectedLayerId}?format=${format}`, creates blob URL, triggers `<a>` click download
- `ExportDialog.svelte:60-97` — Format-specific wrappers: `exportGeoJSON()`, `exportGpkg()`, `exportShp()` — all delegate to `downloadLayer`
- `ExportDialog.svelte:99-132` — `exportPdf()`: captures PNG screenshot via `html-to-image`, sends as POST body with title to `/api/export/${layerId}` endpoint
- `ExportDialog.svelte:134-165` — `exportPNG()`: uses `html-to-image`'s `toPng` on `mapStore.mapContainerEl`, applies 2x pixel ratio, downloads directly (no server round-trip)
- `ExportDialog.svelte:167-196` — `exportAnnotations()`: fetches all annotations via `trpc.annotations.list.query`, transforms to GeoJSON FeatureCollection with properties (author, content, anchor type, timestamps)
- `ExportDialog.svelte:199-340` — Modal UI with layer selector, visual export sections, loading states per button
- `routes/api/export/[layerId]/+server.ts:1-81` — SvelteKit API route: GET handles geojson/gpkg/shp formats; POST handles PDF generation
- `routes/api/export/[layerId]/+server.ts:12-52` — GET handler: dispatches to `exportAsGeoPackage`, `exportAsShapefile`, or inline `toFeatureCollection`
- `routes/api/export/[layerId]/+server.ts:55-81` — POST handler: receives optional screenshot + title, generates PDF via `exportAsPdf`
- `lib/server/export/shared.ts:18-53` — `getExportData()`: fetches layer + features with access control (owner fast-path, then collaborator check)
- `lib/server/export/shared.ts:58-67` — `toFeatureCollection()`: builds standard GeoJSON from export data
- Server export modules: `geopackage.ts`, `shapefile.ts`, `pdf.ts`, `annotations.ts` in `lib/server/export/`

### Reference Patterns

- **svelte-maplibre:** No export built-in. However, its map instance access pattern via `getMapContext()` (used across all components like `ScaleControl.svelte:6`, `NavigationControl.svelte`, etc.) provides a cleaner way to access the map instance for screenshot export. FLI uses `mapStore.mapContainerEl` set via a bind:this + store sync pattern.
- **Allmaps `@allmaps/io`:** Focused on GCP (ground control point) I/O rather than general spatial export. Exports include: `generateGeoreferencedMapGcps` (GCP file formats), `generateGeoreferencedMapsGeotiffScripts` (GeoTIFF shell scripts), `generateCheckCommand` (bash), and `generateLeafletExample`/`generateMapLibreExample`/`generateOpenLayersExample` (plugin code generation). The pattern of code generation for different target platforms is novel but not directly applicable to FLI's data export needs.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | Export API route at `+server.ts:50-51` returns 400 for unknown formats listing only "geojson, gpkg, shp" — but PDF is handled via POST, creating an inconsistent API surface | Document the GET/POST split clearly, or unify under a single method with a `format` field in the body |
| debt | Six individual `exporting*` boolean states in ExportDialog.svelte rather than a single `exportingFormat: string | null` | Replace with `let exportingFormat = $state<string | null>(null)` and derive individual disabled states |
| gap | PNG export uses `html-to-image` on the container DOM element. This captures CSS-rendered content but may miss WebGL canvas content depending on browser. The `preserveDrawingBuffer` flag on MapLibre canvas is the prerequisite | Verify `preserveDrawingBuffer: true` is set on the MapLibre instance; fall back to `map.getCanvas().toDataURL()` if `html-to-image` fails |
| missing | No progress indicator for large layer exports (GeoPackage/Shapefile can be slow for large datasets). The button shows "Exporting..." text but no progress bar | Add streaming progress or at minimum a spinner with estimated size |
| gap | Annotation export (`exportAnnotations`) fetches annotations client-side and builds GeoJSON in the browser. No server-side annotation export route exists (the `annotations/` directory under export exists but `+server.ts` was NOT FOUND there) | Add a server-side `/api/export/annotations` endpoint for consistency and to support larger datasets |
| missing | No multi-layer export. User must export one layer at a time. No "export all layers" or "export map" option | Add a "Export All Layers" option that produces a ZIP with one file per layer |
| gap | Map instance access for screenshot uses `mapStore.mapContainerEl` (bound DOM element synced via store). svelte-maplibre's `getMapContext()` pattern is more idiomatic Svelte (context-based, no global store) | Not actionable for FLI since it already has the mapStore pattern; but worth noting for future refactors |

---

## Flow 12: Panel Navigation

**Trigger:** User clicks toolbar button (Layers/Analysis/Tables/Export in left rail) or SidePanel accordion header (Annotations/Analysis/Activity)
**Outcome:** Relevant panel opens/closes; only one left panel and one side section active at a time

### Current Implementation

- `MapEditor.svelte:135` — `activePanelIcon` state: `'layers' | 'processing' | 'tables' | 'export' | null`, defaults to `'layers'`
- `MapEditor.svelte:158` — `activeSection` state: `SectionId | null` ('annotations' | 'analysis' | 'activity'), defaults to `'annotations'`
- `MapEditor.svelte:122-156` (template) — Left icon rail with 4 buttons: Layers, Analysis, Tables, Export. Each toggles `activePanelIcon` on click.
- `MapEditor.svelte:128` — Layers button: toggles `activePanelIcon` between `'layers'` and `null`
- `MapEditor.svelte:136` (template) — Analysis button: toggles `activePanelIcon` AND sets `activeSection = 'analysis'` (cross-wiring left rail to right panel)
- `MapEditor.svelte:143-144` (template) — Tables button: toggles `showDataTable` boolean (separate from `activePanelIcon` system)
- `MapEditor.svelte:151-152` (template) — Export button: opens dialog via `dialogs.showExportDialog = true` (exits the panel system entirely)
- `MapEditor.svelte:161` (template) — LayerPanel flyout: shown when `activePanelIcon === 'layers'`, 224px wide
- `MapEditor.svelte:183` — `$effect` syncs `activeSection` to `editorState.handleSectionChange(activeSection)` for interaction mode updates
- `SidePanel.svelte:1-2` — Module-level `SectionId` type export: `'annotations' | 'analysis' | 'activity'`
- `SidePanel.svelte:8-16` — `SectionDef` interface: `{ id, label, icon, count?, helpText?, content: Snippet }`
- `SidePanel.svelte:26-28` — `toggle(id)`: if active section matches id, set null (close); otherwise set id (open). Only one section open at a time.
- `SidePanel.svelte:31-98` — Accordion UI: fixed 320px width, each section has chevron + icon + label + optional count badge, content rendered via Snippet
- `MapEditor.svelte:703-710` — SidePanel instantiation with 3 sections array, `activeSection` binding, `onchange` handler
- `MapEditor.svelte:618+` — Snippet definitions: `{#snippet annotations_content()}`, `{#snippet analysis_content()}`, `{#snippet activity_content()}`
- `map-editor-state.svelte.ts:83-86` — `handleSectionChange(section)`: transitions interaction state based on active section changes
- `MapEditor.svelte:167` — Cross-cutting: `measureActive` derived depends on `activeSection === 'analysis'`, creating implicit coupling between panel navigation and measurement mode

### Reference Patterns

- **Allmaps editor:** Uses route-per-view pattern: `apps/editor/src/routes/(views)/` contains `georeference/`, `mask/`, `results/`, `images/` directories, each with its own `+page.svelte`. A shared `+layout.svelte` provides the chrome. Panel "navigation" is actual SvelteKit routing — each view is a full page, state is URL-driven, and browser back/forward works naturally. No accordion or tab state management needed.
- **Allmaps viewer:** Uses modular controls with fine-grained stores: `apps/viewer/src/lib/components/controls/` has Map.svelte (zoom/rotate), View.svelte (map/list/image toggle), Selection.svelte (prev/next map navigation), Transformation.svelte, Dials.svelte. Each control is independent, backed by its own store (opacity.ts, grid.ts, distortion.ts, etc.). Controls are composed in a layout but don't compete for space — they're all visible simultaneously as small toolbar groups.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| debt | Three parallel panel systems in MapEditor: (1) `activePanelIcon` for left rail, (2) `activeSection` for right SidePanel, (3) `showDataTable` boolean and `dialogs` object. These are not unified — e.g., clicking Analysis in the left rail sets BOTH `activePanelIcon` and `activeSection`, but clicking Tables only toggles its own boolean | Unify into a single `EditorLayout` store with explicit panel slots: `{ leftPanel: 'layers'|'processing'|null, rightSection: SectionId|null, bottomPanel: 'table'|null, dialog: 'export'|'share'|'import'|null }` |
| gap | Panel state is not URL-reflected. Refreshing the page resets to default panels (layers + annotations). Deep-linking to a specific panel/section is not possible | Adopt Allmaps editor pattern: encode active panels in URL search params (e.g., `?panel=analysis&tab=measure`) for shareable state |
| gap | The SidePanel is always visible (fixed 320px). There's no way to collapse the entire right panel to give the map more space | Add a collapse/expand toggle for the SidePanel, saving preference to localStorage |
| debt | `activePanelIcon` and `activeSection` are coupled in non-obvious ways: clicking Analysis in the icon rail changes BOTH left and right panel state. This implicit coupling makes the panel behavior unpredictable | Make the left rail and right panel independent, or document the coupling explicitly in the state machine |
| gap | Allmaps viewer's approach of simultaneously visible controls is better for spatial workflows where users need multiple tools accessible at once. FLI's accordion forces single-section visibility | Consider a collapsible-but-not-exclusive mode for SidePanel sections, or a floating panel system |
| missing | No keyboard navigation between panels. Users cannot Tab through panel headers or use arrow keys to switch sections | Add `role="tablist"`/`role="tab"` ARIA pattern to SidePanel headers with arrow key navigation |
| gap | The `handleSectionChange` effect in `map-editor-state.svelte.ts` creates a hidden dependency: changing the active section can transition the entire editor interaction state (e.g., leaving analysis tab exits measurement mode). This side effect is not visible in the template | Make the measurement-mode-exit explicit in the UI (e.g., "Leaving analysis will end your measurement. Continue?") |
