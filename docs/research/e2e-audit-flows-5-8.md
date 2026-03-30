# E2E Flow Audit: Flows 5-8

> Audit date: 2026-03-30
> Reference repos: svelte-maplibre, allmaps

---

## Flow 5: Data Import

**Trigger:** Editor opens ImportDialog, drags/selects a file, clicks Upload
**Outcome:** BullMQ worker processes the file, progress bar updates via polling, layer appears on map

### Current Implementation

- `apps/web/src/lib/components/data/ImportDialog.svelte` — Drag-and-drop + file input UI. Accepts `.geojson`, `.json`, `.csv`, `.kml`, `.gpx`, `.gpkg`, `.geojsonl`, `.zip`. Posts `FormData` to `/api/upload`, then polls `/api/job/[jobId]` every 1s with a 5-minute timeout. Calls `onimported(layerId)` on success.
- `apps/web/src/routes/api/upload/+server.ts` — Validates auth via `requireMapAccess`, enforces 100MB limit, sanitizes filename via `sanitizeFilename` (from import-engine), writes file to `$UPLOAD_DIR/<jobId>/`, inserts `import_jobs` row (status=pending), enqueues BullMQ job via `enqueueImportJob`.
- `apps/web/src/lib/server/jobs/queues.ts` — Lazy BullMQ queue (`file-import`) with 3 retry attempts, exponential backoff (2s base). `enqueueImportJob` adds job with `jobId` as the BullMQ job ID.
- `apps/web/src/routes/api/job/[jobId]/+server.ts` — GET endpoint returns `{ id, status, progress, layerId, errorMessage, fileName }`. Auth-gated via `requireMapAccess`.
- `services/worker/src/index.ts` — BullMQ worker (concurrency=3). `processImportJob` validates payload via Zod schema, guards against path traversal, cleans up partial state from retries, dispatches to format-specific handlers (`processGeoJSON`, `processCSV`, `processShapefile`, etc.). Each handler calls import-engine parsers, auto-detects style via `generateAutoStyle`, creates layer row, batch-inserts features (500/batch with progress updates). Stale job reaper runs hourly for jobs stuck >1h.
- `packages/import-engine/src/` — Pure parser package: `parseGeoJSON`, `parseCSV`, `csvRowsToFeatures`, `parseShapefile`, `parseKML`, `parseGPX`, `parseGeoPackage`, `sanitizeFilename`. No DB access — produces `ParsedFeature[]` or `ParsedWkbFeature[]`.

### Reference Patterns

- **svelte-maplibre:** Not directly comparable — svelte-maplibre is a rendering library, not a data import system. Data arrives as GeoJSON props to `<GeoJSON>` component.
- **Allmaps:** `apps/editor/src/lib/shared/fetch.ts` — URL-based ingestion via `superFetch()`. Fetches IIIF manifests by URL with protocol validation, DNS check (Google DNS API), and structured error types (`INVALID_URL`, `INVALID_PROTOCOL`, `MAYBE_CORS`, `INVALID_DOMAIN`, `STATUS_CODE`, `INVALID_JSON`). No file upload — Allmaps ingests by URL. `@allmaps/annotation` provides `parseAnnotation`/`generateAnnotation`/`validateAnnotation` as pure functions with Zod schemas. Key pattern: **typed error taxonomy** — every fetch failure has a discriminated type, enabling precise UI messages.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | ImportDialog polls via `setInterval` — no exponential backoff on poll, no distinction between network errors and job errors during polling | Add exponential poll backoff and typed error handling for poll failures (network vs 404 vs server error) |
| gap | No file validation before upload — extension check exists but no magic-byte sniffing; a `.geojson` file containing XML will fail deep in the worker | Add client-side content sniffing (first 4 bytes) or at minimum validate JSON parse before upload for JSON formats |
| gap | Upload endpoint buffers entire file in memory (`Buffer.from(await file.arrayBuffer())`) — 100MB limit means up to 100MB in Node.js heap per concurrent upload | Stream file to disk instead of buffering; use `Readable.fromWeb(file.stream()).pipe(createWriteStream(...))` |
| debt | Worker's per-format handlers (`processGeoJSON`, `processCSV`, etc.) are ~50-80 lines each with similar create-layer + batch-insert boilerplate | Extract shared `createLayerAndInsertFeatures(jobId, mapId, layerName, features, style)` helper — the import-engine extraction was a good first step but the worker still has format-specific DB wiring |
| missing | No upload progress (client shows 0% until worker starts); FormData upload of large files has no progress indicator | Use `XMLHttpRequest` or `fetch` with `ReadableStream` to report upload progress before the job even starts |
| gap | Allmaps has typed error taxonomy (`FetchError` with discriminated `type` field) — FLI's import errors are unstructured strings in `errorMessage` column | Define an `ImportErrorType` enum (`parse_failed`, `unsupported_format`, `empty_file`, `geocoding_failed`, etc.) and store structured errors |
| debt | Upload cleanup: uploaded files are never deleted after successful import — `UPLOAD_DIR` grows indefinitely | Add file cleanup in worker `finally` block after successful processing (the `unlink` in the worker only runs in some paths) |

---

## Flow 6: Style Editing

**Trigger:** User clicks layer style button, StylePanel opens
**Outcome:** User changes color/opacity/classification, map re-renders live, style is persisted via tRPC

### Current Implementation

- `apps/web/src/lib/stores/style.svelte.ts` — Minimal store: `_styleOverrides` (Map<layerId, LayerStyle>), `_editingLayerId`, `_showLegend`. Methods: `getStyle`, `setStyle`, `clearStyle`, `setEditingLayer`, `toggleLegend`. Style overrides are ephemeral in-memory state used for live preview before save.
- `apps/web/src/lib/components/style/StylePanel.svelte` — Reads `styleStore.editingLayerId` to find the active layer. Derives `style` from `layer.style`. Detects numeric properties from `layerFeatures` for choropleth attribute picker. Exposes: color picker, opacity slider, classification method (quantile/equal_interval), color ramp selector (ColorBrewer), class count. Uses `generateChoroplethStyle` from geo-engine for graduated styles. Saves via `trpc.layers.updateStyle.mutate()`. Tracks dirty state via `lastSavedStyle` deep comparison.
- `apps/web/src/lib/components/map/map-styles.ts:1-199` — Pure functions: `getLayerPaint(layer, paintType)` builds MapLibre paint objects from `layer.style.paint`, resolves FSL interpolators via `resolvePaintInterpolators`, filters to paint-type prefix, falls back to `PAINT_DEFAULTS`. `getLayerFilter(layer, fslConverter)` extracts FSL `style.filters` + `showOther:false` guard into MapLibre filter expressions.
- `packages/geo-engine/src/style.ts` — `generateChoroplethStyle(layerType, field, values, rampName, nClasses, method)` computes quantile/equal-interval breaks, builds MapLibre `step` expressions, generates legend entries. `resolvePaintInterpolators(paint)` converts FSL zoom interpolators (`{ linear: [[z1,v1],[z2,v2]] }`) to MapLibre `interpolate` expressions. Also: `generateAutoStyle`, `generateSimpleStyle`, `generateCategoricalStyle`.
- `packages/shared-types/src/schemas/style.ts` — `StyleConfigSchema` with FSL-inspired fields: `labelAttribute`, `categoricalAttribute`, `numericAttribute`, `categories`, `steps`, `showOther`, `classificationMethod`, `colorRamp`, `nClasses`. `LayerStyleSchema` wraps `paint` (MapLibre paint object) + `config` (StyleConfig) + `legend` (LegendEntry[]).

### Reference Patterns

- **svelte-maplibre:** `FillLayer.svelte` (and other typed layers) accept `paint` and `layout` as reactive props. `Layer.svelte:~L180-210` uses `diffApplier` to create efficient property-by-property updates — only changed keys are sent to `map.setPaintProperty()`. Filter changes use `map.setFilter()` reactively via `$effect`. This is the gold standard: declarative props -> automatic MapLibre updates with diff optimization.
- **Allmaps:** Not directly comparable for style editing — Allmaps uses WebGL2 custom rendering (`@allmaps/render`) rather than MapLibre's style system. Style is implicit in the transformation/warping pipeline.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | FLI's style→MapLibre bridge is split across 4 files (StylePanel, style store, map-styles.ts, geo-engine/style.ts) vs svelte-maplibre's single reactive prop flow. The FSL abstraction adds a translation layer that svelte-maplibre avoids entirely by using MapLibre's native paint objects as the source of truth | Consider whether the FSL abstraction earns its complexity — if FLI never needs to serialize styles to a non-MapLibre format, the FSL layer is overhead |
| gap | `styleStore.setStyle()` creates a new Map on every call (`new Map(_styleOverrides)`) for reactivity — this works but means every style tweak (e.g., opacity slider drag) copies the entire overrides map | svelte-maplibre's `diffApplier` pattern is more efficient — only diff and apply changed paint keys rather than replacing the whole style object |
| debt | `getLayerPaint` in map-styles.ts manually filters paint keys by prefix (circle-/line-/fill-) — this is fragile if MapLibre adds new prefixed properties | Use MapLibre's type definitions to derive valid keys per layer type, or at minimum add a test that validates against the MapLibre spec |
| gap | Live preview during editing: StylePanel modifies `layer.style` directly via `layersStore` mutation (inferred from the `dirty` tracking). There is no undo for style changes — once saved, the previous style is lost | Add style history (at minimum store `lastSavedStyle` server-side for revert) |
| missing | No debounce on style save — rapid color picker changes could fire many `updateStyle` mutations | Add debounce (300-500ms) on the save path, similar to how the opacity slider should batch updates |
| gap | svelte-maplibre's `diffApplier` ensures only changed properties hit `setPaintProperty` — FLI rebuilds full paint objects on every reactive cycle via `getLayerPaint` | Profile whether full paint rebuild causes jank on layers with complex step expressions; consider adopting diff-based updates |

---

## Flow 7: Filtering

**Trigger:** User opens FilterPanel, adds attribute filters (field + operator + value)
**Outcome:** Map and DataTable update simultaneously — map via MapLibre filter expressions, table via client-side JS filtering

### Current Implementation

- `apps/web/src/lib/components/data/FilterPanel.svelte` — Derives available fields from first 100 features' property keys (excluding `_`-prefixed). Supports 7 operators: `eq`, `ne`, `lt`, `gt`, `cn` (contains), `in`, `ni` (not-in). "Add filter" form with field/operator/value inputs. Displays active filters with remove buttons. Shows `filteredCount` passed from parent.
- `apps/web/src/lib/stores/filters.svelte.ts` — Per-layer filter state in `_filters: Record<string, UIFilter[]>`. Methods: `add`, `remove`, `clear`, `hasFilters`. `toMapLibreFilter(layerId)` converts UIFilters to FSL triples then calls `fslFiltersToMapLibre`. `applyToFeatures(layerId, features)` does client-side filtering via `matchesFilter()` (switch on operator). Persistence via `loadFilters`/`saveFilters` to localStorage (keyed by mapId).
- `packages/geo-engine/src/filters.ts` — `fslFilterToMapLibre(filter)` converts `[field, op, value]` triples to MapLibre expression syntax. Supports: `lt`→`<`, `gt`→`>`, `le`→`<=`, `ge`→`>=`, `eq`→`==`, `ne`→`!=`, `cn`→string `in` (contains), `in`→`match` (set membership), `ni`→negated `match`, `and`→recursive `all`. `fslFiltersToMapLibre(filters[])` wraps multiple in `all`.
- `apps/web/src/lib/components/map/MapCanvas.svelte` (via map-styles.ts) — `getLayerFilter` in MapCanvas combines: (1) persisted FSL `style.filters` from layer style, (2) session-level UI filters from `filterStore.toMapLibreFilter`. Both are merged with `['all', ...parts]` if both present.
- DataTable integration: `MapEditor.svelte` passes `filterStore.applyToFeatures(activeLayer.id, rawFeatures)` as `filteredFeatures` to DataTable component.

### Reference Patterns

- **svelte-maplibre:** `src/lib/filters.ts` — `combineFilters(join, ...filters)` smartly flattens nested `all`/`any` (if a sub-filter already uses the same join type, it splices children instead of nesting). `isClusterFilter(matchClusters)` returns `['has', 'point_count']` or negation. `hoverStateFilter` uses `feature-state`. The `filter` prop on `<Layer>` is reactive — `$effect` calls `map.setFilter(layer, layerFilter)` on change. Key pattern: **composable filter helpers** that compose via `combineFilters` rather than manual array building.
- **svelte-maplibre:** `src/lib/expressions.ts` — `zoomTransition(start, startValue, end, endValue)` builds interpolate expressions. `imageWithFallback` builds coalesce expressions. Pattern: **named expression builders** for common MapLibre expressions.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | FLI's `getLayerFilter` in MapCanvas manually builds `['all', ...parts]` — svelte-maplibre's `combineFilters` is smarter: it flattens nested `all`/`any` to avoid unnecessary nesting (e.g., `all(all(a,b), c)` becomes `all(a,b,c)`) | Adopt `combineFilters`-style flattening in `getLayerFilter` — reduces filter expression depth for MapLibre's evaluator |
| gap | Filter store has dual filtering paths: `toMapLibreFilter` (for map) and `applyToFeatures` (for table). The `matchesFilter` client-side evaluator re-implements filter logic that `fslFiltersToMapLibre` already handles for MapLibre. The `cn` (contains) operator uses `String.includes` client-side but `['in', value, ['get', field]]` for MapLibre — these have different semantics (MapLibre `in` checks substring, JS `includes` checks substring — actually equivalent, but `in`/`ni` set operators use `match` which is set membership, not substring) | Verify `cn` vs `in`/`ni` semantic parity between client-side and MapLibre paths — `cn` uses `includes` (substring) client-side but MapLibre `in` (also substring), which is correct; however `in` operator uses `match` (set membership) in MapLibre but `split(',').includes()` client-side — ensure these are tested end-to-end |
| debt | `availableFields` derives from first 100 features only — sparse columns that only appear in later features will be invisible in the filter picker | Scan all features (or use a server-side schema endpoint) to derive the complete field set |
| gap | Filters are ephemeral (localStorage only) — not persisted to the layer style. Two users viewing the same map see different filters with no way to share. The FSL style schema supports `style.filters` for persisted filters but the UI never writes to it | Add a "Save as default filter" option that writes to `style.filters` via the existing tRPC `updateStyle` endpoint |
| missing | No filter-by-geometry support (e.g., "features within current viewport", "features intersecting drawn polygon") — only attribute filters exist | Consider adding spatial filter operators, which would leverage the existing PostGIS backend |
| gap | svelte-maplibre provides `isClusterFilter` and `hoverStateFilter` as composable filter helpers — FLI has no equivalent helper library, building all filter expressions ad-hoc | Extract a `filter-helpers.ts` with composable builders (combine, cluster, hover-state, spatial) following svelte-maplibre's pattern |

---

## Flow 8: Geoprocessing

**Trigger:** User opens Analysis tab, selects operation + input layer(s) + parameters, clicks Run
**Outcome:** tRPC mutation fires, PostGIS executes spatial SQL, new layer is created and appears on map

### Current Implementation

- `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte` — 10 operations via icon grid: buffer, convex_hull, centroid, dissolve, intersect, union, clip, point_in_polygon, nearest_neighbor, aggregate. Dynamic inputs: layer A/B selects, distance (km), dissolve field, aggregation type/field/output. Auto-generated output name via `computeDefaultName()`. Same-layer guard resets `layerIdB` on collision. Cancel via `AbortController`. Uses `trpc.geoprocessing.run.mutate()`.
- `apps/web/src/lib/server/trpc/routers/geoprocessing.ts` — `protectedProcedure` with `z.object({ mapId, op: GeoprocessingOpSchema, outputLayerName })`. Cross-field validation: aggregate `sum`/`avg` require non-empty `field`. Auth via `requireMapAccess(userId, mapId, 'editor')`. Verifies all input layers belong to the map. Creates output layer row, calls `runGeoprocessing(op, newLayerId)`, detects output geometry type, updates layer type, returns `{ layerId, layerName }`.
- `apps/web/src/lib/server/geo/geoprocessing.ts` — Pure PostGIS dispatch. `runGeoprocessing(op, newLayerId)` sets `statement_timeout = '30s'`, switches on `op.type`. Each handler is a single `INSERT INTO features ... SELECT ... FROM features WHERE layer_id = $source` with the relevant `ST_*` function. `getOpLayerIds(op)` extracts source layer IDs for ownership verification. `assertNever` default ensures exhaustive handling.
- `packages/shared-types/src/schemas/geoprocessing.ts` — Zod discriminated union (`GeoprocessingOpSchema`) with 10 narrow per-op schemas. Each constrains only relevant params (e.g., `GeoBufferOpSchema` has `distanceKm: z.number().positive().max(1000)`). `GEO_OP_LABELS` provides human-readable names.

### Reference Patterns

- **Allmaps:** `@allmaps/transform` — Pure-function coordinate transformation package. Exports `GcpTransformer`, `GeneralGcpTransformer`, plus individual transformation types (`Helmert`, `Polynomial1-3`, `Projective`, `RBF`, `Straight`). Key pattern: **each transformation is a standalone class** with `transformToGeo`/`transformToResource` methods — no DB, no IO, fully unit-testable. `@allmaps/analyze` provides distortion analysis as a separate pure package. The editor's `annotation.ts` composes these: `parseAnnotation` -> `GcpTransformer(gcps, type)` -> `transformToGeo([resourceMask])` -> `computeBbox`.
- **Allmaps architecture:** Pure-function packages (`transform`, `analyze`, `annotation`) are composed by the app layer. Each package has a single responsibility and zero infrastructure dependencies. This is the inverse of FLI's approach where geoprocessing logic lives in the server layer with direct DB access.

### Findings

| Category | Finding | Recommendation |
|----------|---------|----------------|
| gap | FLI's geoprocessing is tightly coupled to PostGIS — every operation is a raw SQL `INSERT...SELECT` with `ST_*` functions. This means: (1) operations cannot be previewed client-side, (2) operations cannot be unit-tested without a database, (3) adding a non-PostGIS operation (e.g., Turf.js client-side buffer for small datasets) requires a different code path | Allmaps pattern: extract a `@felt-like-it/geoprocessing` package with pure-function operations for small datasets (using Turf.js), keeping PostGIS path for large datasets. The dispatch layer decides based on feature count |
| debt | Each PostGIS operation is inline SQL in `geoprocessing.ts` — 10 operations x ~10 lines each = ~100 lines of SQL strings. No SQL testing (would require a test database). The `assertNever` exhaustiveness check is good but compile-time only | Add integration tests with a test database for each operation; consider extracting SQL templates to a testable format |
| gap | 30-second `statement_timeout` is the only resource guard. No feature-count check before execution — a buffer on a 1M-feature layer will likely timeout, leaving the user with a generic error | Add pre-flight feature count check; warn or reject operations above a threshold (e.g., 100K features for buffer/intersect); show estimated time |
| missing | No operation preview — user cannot see what the result will look like before committing. Allmaps lets users see transformation results interactively before saving | For simple operations (buffer, centroid), compute a preview on a sample (first 100 features) via Turf.js client-side and render as a temporary layer |
| gap | No progress reporting for geoprocessing — the mutation is synchronous (tRPC request/response). Long operations leave the user staring at a spinner with no feedback. Compare to Flow 5 (import) which has proper progress polling | For operations expected to take >2s, use the same BullMQ job pattern as import: create job, return jobId, poll for completion with progress |
| gap | Geoprocessing result has no provenance metadata — the output layer doesn't record what operation, parameters, or input layers produced it. There's a `map_event` log entry but nothing on the layer itself | Store operation metadata (op type, params, source layer IDs) on the output layer's `metadata` or `source_file_name` field for auditability and potential "re-run" |
| debt | The router's cross-field validation for aggregate `sum`/`avg` uses `.superRefine` — this works but the validation is disconnected from the schema definition. The per-op schemas are well-designed (narrow, discriminated) but the cross-op invariants live in the router | Move aggregate field validation into the schema itself using `.refine` on `GeoAggregateBaseSchema` |
| gap | Allmaps separates `transform` (coordinate math) from `analyze` (quality metrics) as independent packages. FLI bundles all geoprocessing in one server file with no analysis/quality layer | Consider adding a quality layer: validation of output geometry (empty results, degenerate geometries), statistics on the result (feature count, area/length summary), distortion warnings for operations like buffer on geographic coordinates |
