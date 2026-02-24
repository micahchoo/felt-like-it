# Felt Like It — Build State

## Phase 4 — Spatial Analysis ✅ COMPLETE

**Tests:** 518 passing (shared-types: 96 · geo-engine: 178 · web: 244)
**svelte-check:** 0 errors · 0 warnings
**Lint (web):** 0 errors · 0 warnings

---

## Delta — this round (deck.gl heatmap + doc fixes)

### Added
- `apps/web/src/lib/components/map/DeckGLOverlay.svelte`
  - `HeatmapLayerDef` interface (exported) — `id`, `features`, `radiusPixels`, `intensity`, optional `weightAttribute`
  - Effect 1: manages `MapboxOverlay` lifecycle (create / `addControl` / `removeControl`) when `map` changes
  - Effect 2: syncs `HeatmapLayer` instances to overlay via `setProps` when `layers` or `overlay` change
  - `interleaved: false` → deck.gl renders on its own canvas above MapLibre (no shared WebGL context)

### Changed
- `packages/shared-types/src/schemas/style.ts`
  - `LayerStyleSchema.type` — adds `'heatmap'` variant
  - `StyleConfigSchema` — adds `heatmapRadius` (int 1–200), `heatmapIntensity` (0.1–5), `heatmapWeightAttribute` (string, optional)
- `packages/shared-types/src/__tests__/schemas.test.ts` — 9 new tests (heatmap type, heatmap config fields, range validation); total 96
- `apps/web/package.json` — adds `deck.gl@9.2.9`, `@deck.gl/mapbox@9.2.9`
- `apps/web/src/lib/components/map/MapCanvas.svelte`
  - Imports `DeckGLOverlay` and `HeatmapLayerDef`
  - `heatmapLayerDefs` `$derived` — filters layers with `style.type === 'heatmap'`, extracts Point features, maps config to `HeatmapLayerDef`; `exactOptionalPropertyTypes`-safe conditional spread for `weightAttribute`
  - `{#each}` skips MapLibre GeoJSONSource/VectorTileSource for heatmap layers (`!isHeatmap` guard)
  - Mounts `<DeckGLOverlay map={mapInstance} layers={heatmapLayerDefs} />` outside `<MapLibre>`
- `apps/web/src/lib/components/style/StylePanel.svelte`
  - `showHeatmap` derived — true when all features in `layerFeatures` are Point geometry
  - `heatmapWeightAttr`, `heatmapRadius` (default 30), `heatmapIntensity` (default 1.0) state
  - `$effect` restores config from existing style on layer switch
  - `applyHeatmap()` — sets `style.type = 'heatmap'`, saves via tRPC, updates stores
  - `resetToSimple()` — reverts to `style.type = 'simple'` with circle defaults
  - Heatmap UI section (weight attr dropdown, radius/intensity sliders, Apply + Reset buttons) inside scroll container
- `docs/ROADMAP.md`
  - Phase 4 header: ⬜ → ✅ COMPLETE
  - Spatial joins, Aggregation, Boundary analysis rows: ⬜ → ✅ (previously implemented, doc drift fixed)
  - deck.gl row: ⬜ → ✅

---

## Gaps — known blockers / debt

- **None blocking merge.**
- `TODO(loop):` annotation `contentJson` popup parse is unvalidated (JSON.parse cast, no Zod safeParse) — pre-existing TYPE_DEBT comment; safe because content originates from DB + Zod schema.
- Collaborator roles stored but NOT enforced on tRPC procedures — Phase 5 hardening.
- `TODO(loop):` multi-table GeoPackage import still first-table-only.
- Worker lint not counted — pre-existing `no-undef`.
- Measurement tool: live/interactive measurement not implemented — only the final finished shape is measured.
- `GeoAggregateBaseSchema` used in discriminated union (not refined); field invariant enforced at router only.
- deck.gl heatmap covers Phase 4 scope. 3D buildings and ScatterplotLayer are natural Phase 5 additions.

---

## Phase 4 checklist

| Item | Status |
|---|------|
| **PostGIS geoprocessing UI** (buffer, clip, intersect, union, dissolve, convex hull, centroid) | ✅ |
| **Rich annotation suite** (text / emoji / GIF / image+upload+EXIF / link / IIIF NavPlace) | ✅ |
| **Measurement tools** (distance, area, perimeter; km/mi/m/ft and km²/mi²/ha/ac/m²; adaptive formatting) | ✅ |
| **Spatial joins** (point-in-polygon, nearest neighbor) | ✅ |
| **Aggregation** (point-to-polygon count / sum / avg) | ✅ |
| **Boundary analysis + choropleth** (9 ColorBrewer ramps; quantile + equal-interval; StylePanel choropleth UI) | ✅ |
| **deck.gl integration** (heatmap overlay; DeckGLOverlay; radius/intensity/weight-attr controls) | ✅ |
