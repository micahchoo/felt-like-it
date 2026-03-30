# FLI E2E Flow Audit — Consolidated

> Audit date: 2026-03-30
> References: `svelte-maplibre`, `allmaps`
> Detailed findings: `e2e-flow-audit.md` (flows 1-4), `e2e-audit-flows-5-8.md`, `flow-audit-9-12.md`, `e2e-audit-flows-13-16.md`

---

## Critical Bugs

| # | Bug | Location | Impact |
|---|-----|----------|--------|
| B1 | `handleCreate` recursively calls itself instead of `actions.onCreate(title)` | `DashboardScreen.svelte:26-34` | Infinite recursion on map creation from dashboard |

---

## Synthesis by Category

### Foundations (Debt) — fix before anything else

| ID | Finding | Flows | Fix |
|----|---------|-------|-----|
| D1 | **MapCanvas 887-line monolith** — rendering, click handling, annotations, badges, measurement, hot overlays, popup, drawing toolbar all in one file | 2,3,4,9,10 | Decompose: DataLayers, AnnotationLayers, MeasurementLayers, InteractionManager as child components inside `<MapLibre>` |
| D2 | **AnnotationPanel ~1200 lines** — 6 mutations, blob upload, form state, anchor placement, thread rendering, list management | 10 | Split: AnnotationForm, AnnotationList, AnnotationMutations (hooks), BlobUpload |
| D3 | **Three parallel panel systems** — `activePanelIcon`, `activeSection`, `showDataTable`+`dialogs` with implicit cross-wiring | 12 | Unify into single `EditorLayout` store: `{ leftPanel, rightSection, bottomPanel, dialog }` |
| D4 | **Dual creation paths** — form actions (dead code) + tRPC both create maps | 1 | Remove dead form actions |
| D5 | **Duplicated token resolution** — `+page.server.ts` vs `shares.resolve` tRPC | 13 | Extract shared helper or call tRPC internally |
| D6 | **Duplicated comment pagination** — `list` vs `listForShare` | 15 | Extract shared pagination helper |
| D7 | **Two embed snippets** — ShareDialog (800x600) vs ShareViewerScreen (100%/500) | 14 | Consolidate to `generateEmbedSnippet()` utility |
| D8 | **TYPE_DEBT paint casts** — dynamic paint builders return `Record<string,unknown>`, requiring casts on every sublayer | 2 | Type paint builders to return proper MapLibre spec types |
| D9 | **Upload buffers full file in memory** — up to 100MB per concurrent upload | 5 | Stream to disk: `Readable.fromWeb(file.stream()).pipe(createWriteStream(...))` |
| D10 | **Uploaded files never cleaned up** — `UPLOAD_DIR` grows indefinitely | 5 | Add cleanup in worker `finally` block |
| D11 | **6 boolean loading states** in ExportDialog | 11 | Replace with `exportingFormat: string | null` |
| D12 | **Worker format handlers share boilerplate** — ~50-80 lines each with similar create-layer + batch-insert | 5 | Extract `createLayerAndInsertFeatures()` helper |
| D13 | **Filter field discovery from first 100 features only** — sparse columns invisible | 7 | Server-side schema endpoint or full scan |
| D14 | **Geoprocessing inline SQL** — 10 ops x ~10 lines, untestable without DB | 8 | Integration tests with test database |
| D15 | **`getLayerPaint` filters by prefix** — fragile if MapLibre adds properties | 6 | Use MapLibre type definitions to derive valid keys |
| D16 | **Measurement state scattered** in MapEditor local vars | 9 | Extract `createMeasurementStore()` |
| D17 | **Delete returns NOT_FOUND for non-authors** — conflates "not yours" with "doesn't exist" | 15 | Return FORBIDDEN when comment exists but isn't owned |
| D18 | **Aggregate field validation in router** — disconnected from schema | 8 | Move into `GeoAggregateBaseSchema.refine()` |

### Simplifications — reference-driven cleanup

| ID | Finding | Reference Pattern | Flows | Fix |
|----|---------|-------------------|-------|-----|
| S1 | **Not using svelte-maplibre-gl interaction primitives** — no `manageHoverState`, `eventsIfTopMost`, nested `<Popup>`, `hoverCursor` | svelte-maplibre Layer.svelte | 2,3 | Add these props to clickable sublayers; eliminates ~100 lines of manual code |
| S2 | **Triple onclick duplication** — 6 copies of same click handler per layer (3 sublayers × 2 branches) | svelte-maplibre nested `<Popup>` | 2 | Shared handler function or nested popup pattern |
| S3 | **Paint-based highlighting** — `applyHighlight()` wraps entire paint in `case` expression | svelte-maplibre `map.setFeatureState` | 3 | Migrate to feature-state-based highlight |
| S4 | **300ms click dedup hack** — manual timestamp guard for overlapping layers | svelte-maplibre `eventsIfTopMost` | 3 | Use `eventsIfTopMost={true}` |
| S5 | **FSL style bridge complexity** — 4-file chain (StylePanel→store→map-styles→geo-engine) | svelte-maplibre reactive paint props + `diffApplier` | 6 | Evaluate whether FSL abstraction earns its cost |
| S6 | **Manual filter expression building** — ad-hoc `['all', ...parts]` | svelte-maplibre `combineFilters` | 7 | Adopt composable filter helpers with smart flattening |
| S7 | **Full MapEditor for embed/share** — ships undo, drawing, filters, annotation infrastructure for read-only views | Allmaps viewer: decomposed stores, minimal layout | 13,14 | Lightweight `ReadOnlyMapCanvas` or code-split embed route |
| S8 | **Full paint object rebuild per cycle** — `$derived.by` cache correct but expensive | svelte-maplibre `diffApplier` (key-by-key) | 6 | Profile; consider diff-based paint updates |
| S9 | **Popup at MapLibre level** — conditional render chain instead of declarative composition | svelte-maplibre `<Popup>` nested in `<Layer>` | 3 | Nest popup inside clickable layers |
| S10 | **Geoprocessing tightly coupled to PostGIS** — can't preview, can't unit-test without DB | Allmaps pure-function packages (`@allmaps/transform`, `@allmaps/analyze`) | 8 | Extract `@felt-like-it/geoprocessing` with Turf.js for small datasets |
| S11 | **"Save as annotation" forces panel switch** — loses measurement context | Allmaps modular controls (visible simultaneously) | 9 | Allow save without leaving measurement panel |

### Enhancements — better existing flows

| ID | Finding | Reference Pattern | Flows | Fix |
|----|---------|-------------------|-------|-----|
| E1 | **Zero hover feedback** on data features — no cursor, no visual change, no preview | svelte-maplibre `manageHoverState` + hover paint expressions | 3 | `manageHoverState={true}`, `hoverCursor="pointer"`, hover-aware paint |
| E2 | **No hover tooltip** for data features (only annotation pins have one) | svelte-maplibre `<Popup openOn="hover">` | 3 | Lightweight hover preview popup |
| E3 | **No cooperative gestures** for embedded maps — scroll-hijacking | svelte-maplibre `cooperativeGestures` prop | 14 | Enable when `embed={true}` |
| E4 | **No URL-encoded viewport** in share/embed links | svelte-maplibre `hash.ts` | 13 | Add `#zoom/lat/lng` hash to share URLs |
| E5 | **No debounce on style save** — rapid changes fire many mutations | svelte-maplibre diff-based updates | 6 | 300-500ms debounce on save path |
| E6 | **No style undo/history** — once saved, previous style lost | — | 6 | Store `lastSavedStyle` server-side for revert |
| E7 | **No geoprocessing preview** — user can't see result before committing | Allmaps interactive transformation preview | 8 | Turf.js preview on first 100 features |
| E8 | **No floating measurement tooltip** near geometry | svelte-maplibre `<Popup>` positioning | 9 | Popup at midpoint/centroid of measurement |
| E9 | **No annotation schema versioning** | Allmaps multi-version parse/validate/generate pipeline | 10 | Add `version` field to content schema |
| E10 | **No optimistic UI on draw** — feature vanishes during server round-trip | — | 4 | Add to `hotOverlay` immediately, replace on confirm |
| E11 | **DrawActionRow auto-dismiss** — 8s too aggressive | — | 4 | Keep visible until user acts |
| E12 | **No pre-flight size check for geoprocessing** — 30s timeout only guard | — | 8 | Warn/reject above threshold |
| E13 | **No keyboard shortcut for measurement** | — | 9 | Add `M` shortcut |
| E14 | **Panel state not URL-reflected** — refresh resets, no deep-linking | Allmaps route-per-view | 12 | Encode active panels in URL search params |
| E15 | **No loading state for share resolution** | — | 13 | Skeleton/streaming with SvelteKit defer |
| E16 | **No guest comment badge** — no visual distinction from authenticated | — | 15 | Display "Guest" badge when `userId === null` |
| E17 | **Import polling has no backoff** — fixed 1s interval regardless of job status | Allmaps typed error taxonomy | 5 | Exponential poll backoff + typed error handling |
| E18 | **No upload progress indicator** — 0% until worker starts | — | 5 | XMLHttpRequest with progress events |
| E19 | **Filters ephemeral** — localStorage only, not shareable | — | 7 | "Save as default filter" writing to `style.filters` |
| E20 | **No z-ordering via beforeLayerType** — data renders above map labels | svelte-maplibre `beforeLayerType` | 2 | `beforeLayerType="symbol"` on fill/line layers |
| E21 | **No result provenance** — output layers don't record source operation | — | 8 | Store op metadata on layer |
| E22 | **SidePanel not collapsible** — always 320px, no way to give map more space | Allmaps viewer modular controls | 12 | Collapse/expand toggle with localStorage preference |

### Features (Missing) — new E2E flows

| ID | Feature | Reference Pattern | Flows |
|----|---------|-------------------|-------|
| F1 | **Clustering** — automatic cluster/uncluster for large point layers | svelte-maplibre `<GeoJSON cluster={...}>` + cluster layers | 2 |
| F2 | **Rich markers** — custom HTML markers per feature (icons, badges, mini-cards) | svelte-maplibre `<MarkerLayer>` | 2 |
| F3 | **Data joins** — merge external CSV with map features client-side | svelte-maplibre `<JoinedData>` | 7 |
| F4 | **Image overlays** — georeferenced raster overlays on map | Allmaps `WarpedMapLayer` (CustomLayerInterface + WebGL2) | 2 |
| F5 | **Multi-layer export** — ZIP with one file per layer | — | 11 |
| F6 | **Spatial filters** — within viewport, intersecting polygon | — | 7 |
| F7 | **Real-time comment updates** — live comment feed without manual refresh | Allmaps EventTarget pattern | 15 |
| F8 | **Invite unregistered users** — pending invitations resolved on signup | — | 16 |
| F9 | **Accept/decline collaboration** — invitation state management | — | 16 |
| F10 | **Client-side drawing validation** — self-intersection, zero-area, duplicate points | — | 4 |
| F11 | **Comment editing** — update body within time window | — | 15 |
| F12 | **Share link expiration** — TTL, access logging | — | 13 |

---

## Execution Order (proposed)

Based on dependencies and the audit→simplify→enhance→feature→simplify sandwich:

### Wave 0: Bug fix
- **B1** — handleCreate recursion (blocks all dashboard work)

### Wave 1: Foundation simplification (layer rendering flow)
- **D1** — Decompose MapCanvas → DataLayers, AnnotationLayers, MeasurementLayers, InteractionManager
- **D8** — Type paint builders properly
- **S1** — Adopt svelte-maplibre-gl interaction primitives
- **S2** — Eliminate onclick duplication
- **S3** — Feature-state-based highlighting
- **S4** — `eventsIfTopMost` replaces dedup hack

### Wave 2: Feature interaction enhancement
- **E1** — Hover feedback
- **E2** — Hover tooltip
- **E10** — Optimistic draw UI
- **S9** — Composable popup pattern
- **E20** — z-ordering via beforeLayerType

### Wave 3: Panel + state simplification
- **D3** — Unified EditorLayout store
- **D4** — Remove dead form actions
- **D16** — Extract measurement store
- **E14** — URL-reflected panel state
- **E22** — Collapsible SidePanel

### Wave 4: Data pipeline cleanup
- **D9** — Stream uploads
- **D10** — File cleanup
- **D12** — Worker helper extraction
- **E17** — Poll backoff
- **E18** — Upload progress

### Wave 5: New features (cluster + markers)
- **F1** — Clustering
- **F2** — Rich markers
- **E3** — Cooperative gestures for embed

### Wave 6: New features (data + overlays)
- **F3** — Data joins
- **F4** — Image overlays
- **S10** — Geoprocessing pure-function extraction

### Wave 7: Polish + collaboration
- **D2** — Decompose AnnotationPanel
- **E9** — Annotation schema versioning
- **D5, D6, D7** — Dedup token resolution, comment pagination, embed snippets
- **S7** — Lightweight embed/share viewer
- **F5** — Multi-layer export

### Wave 8: Collaboration v2 groundwork
- **F7** — Real-time comment updates
- **F8** — Invite unregistered users
- **F9** — Accept/decline flow
- **E16** — Guest comment badge

---

## Metrics

| Category | Count |
|----------|-------|
| Critical bugs | 1 |
| Debt (foundations) | 18 |
| Simplifications | 11 |
| Enhancements | 22 |
| Missing features | 12 |
| **Total findings** | **64** |

| Flow | Debt | Simplification | Enhancement | Feature |
|------|------|----------------|-------------|---------|
| 1. Map creation | 2 | — | — | — |
| 2. Layer rendering | 2 | 4 | 1 | 2 |
| 3. Feature interaction | 1 | 3 | 2 | — |
| 4. Drawing | 1 | — | 2 | 1 |
| 5. Data import | 4 | — | 2 | — |
| 6. Style editing | 2 | 2 | 2 | — |
| 7. Filtering | 1 | 1 | 1 | 2 |
| 8. Geoprocessing | 2 | 1 | 3 | — |
| 9. Measurement | 1 | 1 | 2 | — |
| 10. Annotations | — | — | 2 | — |
| 11. Export | 1 | — | — | 1 |
| 12. Panel navigation | — | — | 2 | — |
| 13. Sharing | 1 | 1 | 2 | 1 |
| 14. Embedding | 1 | 1 | 1 | — |
| 15. Commenting | 1 | — | 1 | 3 |
| 16. Collaboration | — | — | — | 2 |
