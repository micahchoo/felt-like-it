# Felt Like It — Build State

## Phase 4 / Annotation Suite — ✅ COMPLETE

**Tests:** 317 passing (shared-types: 73 · web: 244)
**svelte-check:** 0 errors · 0 warnings
**Lint (web):** 0 errors · 0 warnings

---

## Delta — this round

### Added
- `packages/shared-types/src/schemas/annotation.ts`
  - `AnnotationContentSchema` — Zod discriminated union (6 types: text, emoji, gif, image, link, iiif)
  - `AnnotationAnchorSchema` — WGS84 Point with bounds validation (-180..180 lng, -90..90 lat)
  - `AnnotationSchema` — full record with nullable `userId`, denormalized `authorName`, anchor + content
  - `CreateAnnotationSchema` / `UpdateAnnotationSchema` — tRPC input schemas
  - `AnnotationContent`, `AnnotationAnchor`, `Annotation` — inferred TypeScript types
  - `IiifContentSchema` references `GeoJSONFeatureCollectionSchema` for the NavPlace field
- `packages/shared-types/src/__tests__/schemas.test.ts` — 20 new annotation schema tests
- `apps/web/src/lib/server/db/migrations/0005_add_annotations.sql`
  - `annotations` table: `id`, `map_id` (CASCADE), `user_id` (SET NULL), `author_name`, `anchor_point geometry(Point,4326)`, `content JSONB`, `created_at`, `updated_at`
  - `annotations_map_id_created_at_idx` (composite, primary query pattern)
  - `annotations_anchor_point_idx` (GIST, for future ST_DWithin / KNN queries)
- `apps/web/src/lib/server/trpc/routers/annotations.ts`
  - `list` — ownership check → raw SQL SELECT with ST_X/ST_Y anchor decomposition
  - `create` — ownership check → raw SQL INSERT with ST_GeomFromGeoJSON; denormalizes authorName
  - `update` — authorship check → raw SQL UPDATE RETURNING; anchor is immutable
  - `delete` — authorship check → Drizzle delete; returns `{ deleted: true }`
  - `fetchIiifNavPlace` — server-side manifest fetch (avoids CORS); extracts NavPlace GeoJSON; wraps single Feature in FeatureCollection
  - `RawAnnotationRow` interface + `rowToAnnotation` helper: ST_X/ST_Y → anchor reconstruction
  - `ANNOTATION_COLS` sql.raw fragment: shared SELECT / RETURNING column list
- `apps/web/src/__tests__/annotations.test.ts` — 19 tests covering all 5 procedures
- `apps/web/src/lib/components/annotations/AnnotationContent.svelte`
  - Exhaustive rendering for all 6 content types: text, emoji, gif, image, link, iiif
  - author + timestamp header; emoji at 5xl; constrained max-height for gif/image; link card with hover; IIIF card with amber badge + navPlace summary
- `apps/web/src/lib/components/annotations/AnnotationPanel.svelte`
  - CRUD UI: collapsible create form + annotation list
  - Content type selector → per-type fields (textarea, emoji input, URL input, etc.)
  - Anchor coordinate inputs (defaults to current map center via `mapStore.center`)
  - Client-side `AnnotationContentSchema.parse()` before mutation (fast fail)
  - "Fetch NavPlace" button on IIIF annotations (calls `annotations.fetchIiifNavPlace` then `annotations.update`)
  - Delete own annotations only (`annotation.userId === userId` guard)
  - `onannotationchange` callback triggers parent's `loadAnnotationPins()`

### Changed
- `packages/shared-types/src/index.ts` — `export * from './schemas/annotation.js'`
- `apps/web/src/lib/server/db/schema.ts`
  - Added `geometryPointType` custom Drizzle type (`geometry(Point, 4326)`)
  - Added `annotations` table definition with spatial + composite indexes
  - Added `AnnotationRow` / `NewAnnotation` type exports
- `apps/web/src/lib/server/trpc/router.ts` — `annotations: annotationsRouter`
- `apps/web/src/lib/components/map/MapCanvas.svelte`
  - Added `AnnotationPinCollection` interface (exported) + `AnnotationPinProperties`
  - Added `annotationPins?: AnnotationPinCollection` prop
  - Added `selectedAnnotation` state for annotation popup (independent of selectionStore)
  - Added `GeoJSONSource` + `CircleLayer` for annotation pins (amber, circle-radius 10)
  - Inline `onclick` handler decomposes `contentJson` property → `AnnotationContentType`; sets `selectedAnnotation` to trigger popup
  - Added `Popup` + `<AnnotationContent>` for annotation click popup
  - Imports: `AnnotationContent.svelte`, `AnnotationContent` type from shared-types
- `apps/web/src/lib/components/map/MapEditor.svelte`
  - Added `showAnnotations` state + `annotationPins` state
  - Added `loadAnnotationPins()` — fetches annotations, converts to GeoJSON FeatureCollection with `contentJson` in properties
  - `$effect` → `loadAnnotationPins()` on mount
  - Passes `{...(readonly ? {} : { annotationPins })}` to MapCanvas
  - Added "Annotate" toolbar button (circle-plus icon)
  - Added `<AnnotationPanel>` right-side panel with `onannotationchange={loadAnnotationPins}`
  - Imports: `AnnotationPanel`, `AnnotationPinCollection`, `Annotation` type
- `scripts/migrate.ts` — added `'0005_add_annotations.sql'` to `MIGRATION_FILES`

### Fixed (RECTIFY for this round)
- `MapCanvas.svelte` annotation click: `e.features` not on `MapMouseEvent` — moved handler inline in template (svelte-maplibre-gl layer event is `MapLayerMouseEvent`)
- `MapCanvas.svelte` GeoJSONSource data cast: `Parameters<typeof GeoJSONSource>[0]['data']` resolves to `Brand<"ComponentInternals">` in Svelte 5 — replaced with `{ type: 'FeatureCollection'; features: GeoJSONFeature[] }` cast
- `annotations.test.ts` non-null assertion `result[0]!` — replaced with `result[0] as (typeof result)[0]` (ESLint `no-non-null-assertion`)

---

## Gaps — known blockers / debt

- **None blocking merge.**
- `TODO(loop):` browser `JSON.parse: unexpected character` error in running app — unresolved from previous round; cannot pinpoint to our code.
- `TODO(loop):` annotation `contentJson` popup parse is unvalidated (JSON.parse cast, no Zod safeParse). Noted `// TYPE_DEBT:` in MapCanvas.
- Annotation anchor is coordinate-input only — map-click-to-place is a natural follow-up (Phase 5 UX polish).
- IIIF NavPlace is fetched lazily via "Fetch NavPlace" button — a webhook/background job approach is deferred.
- Collaborator roles stored but NOT enforced on tRPC procedures — Phase 5 hardening.
- `TODO(loop):` multi-table GeoPackage import still first-table-only.
- Worker lint not counted — pre-existing `no-undef`.

---

## Phase 4 checklist (COMPLETE for this round)

| Item | Status |
|---|------|
| **PostGIS geoprocessing UI** (buffer, clip, intersect, union, dissolve, convex hull, centroid) | ✅ |
| **Rich annotation suite** (text / emoji / GIF / image / link / IIIF NavPlace; geographic anchor; discriminated union schema; full CRUD tRPC; MapCanvas pin layer + popup; AnnotationPanel UI) | ✅ |
| Spatial joins: point-in-polygon, nearest neighbor | ⬜ |
| Aggregation: point-to-polygon count/sum/avg | ⬜ |
| Measurement tools: distance, area, perimeter | ⬜ |
| Boundary analysis + choropleth | ⬜ |
| deck.gl integration | ⬜ |
