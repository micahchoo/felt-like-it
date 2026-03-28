# Geoprocessing Subsystem — Components (Zoom Level 5)

> Inventory of every component in the geoprocessing subsystem: UI panels, server functions, PostGIS operations, spatial joins, measurement utilities, and state management.

## Subsystem Map

```
                          ┌─────────────────────────────────┐
                          │         MapEditor.svelte         │
                          │   (orchestrator, tab state)      │
                          └──┬──────────────┬───────────────┘
                             │              │
              ┌──────────────▼──┐    ┌──────▼──────────────┐
              │ GeoprocessingPanel │  │ MeasurementPanel    │
              │   (PostGIS ops)    │  │  (Turf.js results)  │
              └────────┬───────────┘  └──────▲──────────────┘
                       │ tRPC mutate         │ measureResult
              ┌────────▼───────────┐  ┌──────┴──────────────┐
              │ geoprocessingRouter │  │ DrawingToolbar      │
              │  (trpc/routers/)   │  │  (measurement mode)  │
              └────────┬───────────┘  └──────┬──────────────┘
                       │                     │ measureLine/Polygon
              ┌────────▼───────────┐  ┌──────▼──────────────┐
              │ runGeoprocessing() │  │ geo-engine/          │
              │  (PostGIS SQL)     │  │  measurement.ts      │
              └────────┬───────────┘  └─────────────────────┘
                       │
              ┌────────▼───────────┐
              │   PostGIS / DB     │
              │  (features table)  │
              └────────────────────┘
```

---

## 1. UI Components

### 1.1 GeoprocessingPanel.svelte

**File:** `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte`

The primary UI for all 10 PostGIS-backed operations. Renders inside the MapEditor's SidePanel under the "Analysis" section, toggled via the `analysisTab === 'process'` state.

| Aspect | Detail |
|--------|--------|
| **Props** | `mapId: string`, `layers: Layer[]`, `onlayercreated: (layerId) => void`, `embedded?: boolean` |
| **Mutation** | `trpc.geoprocessing.run.mutate` via `@tanstack/svelte-query` `createMutation` |
| **Cache invalidation** | `queryKeys.layers.list({ mapId })` on success |
| **Op selection** | 4x4 icon grid — each op type gets a Lucide icon (`CircleDot`, `Triangle`, `Crosshair`, `Droplets`, `Merge`, `CircleDashed`, `Scissors`, `MapPin`, `Radar`, `BarChart3`) |
| **Dynamic inputs** | Layer A/B selects, distance (km) for buffer, dissolve field, aggregation type/field/output field — all conditionally shown via `TWO_LAYER_OPS`, `DIST_OPS`, `FIELD_OPS`, `AGG_OPS` sets (lines 39-44) |
| **Output name** | Auto-generated from `computeDefaultName()` (line 81), e.g. "Layer (buffered)", overridable |
| **Same-layer guard** | `$effect` at line 59 resets `layerIdB` when it collides with `layerIdA` |
| **Error display** | `extractErrorMessage()` (line 144) extracts from tRPC shape, falls back to op-specific hints |
| **Cancel** | `AbortController` stored at line 70; abort button shown during `running` state |

### 1.2 MeasurementPanel.svelte

**File:** `apps/web/src/lib/components/map/MeasurementPanel.svelte`

Displays ephemeral Turf.js measurement results. Renders inside the SidePanel when `analysisTab === 'measure'`.

| Aspect | Detail |
|--------|--------|
| **Props** | `measureResult: MeasurementResult \| null`, `onclear: () => void`, `onsaveasannotation: (payload) => void` |
| **Distance display** | Total distance (large card), nodes/segments count, unit toggle (km/mi/m/ft) |
| **Area display** | Area (large card), perimeter, nodes/segments, separate unit toggles for area (km2/mi2/ha/ac/m2) and perimeter (km/mi/m/ft) |
| **Save as annotation** | Builds a `SaveAsAnnotationPayload` with geometry + display value, transitions interaction state to `pendingMeasurement` |
| **Formatting** | Delegates to `formatDistance()` and `formatArea()` from `@felt-like-it/geo-engine` |

### 1.3 DrawingToolbar.svelte (Measurement Mode)

**File:** `apps/web/src/lib/components/map/DrawingToolbar.svelte`

When `onmeasured` prop is provided (line 29), the toolbar enters measurement mode:
- Drawn features are NOT saved to any layer (line 81-83)
- `measureFeature()` (line 133) dispatches to `measureLine()` or `measurePolygon()` based on geometry type
- Point tool is hidden in measurement mode (line 348: "Points cannot be measured")

### 1.4 MapEditor.svelte (Orchestrator)

**File:** `apps/web/src/lib/components/map/MapEditor.svelte`

Owns the tab/panel state that wires everything together:

- **`activeSection`** (line 170): `SectionId | null` — SidePanel section, `'analysis'` hosts both tabs
- **`analysisTab`** (line 171): `'measure' | 'process'` — toggles between MeasurementPanel and GeoprocessingPanel
- **`measureResult`** (line 153): `MeasurementResult | null` — ephemeral measurement state
- **`measureActive`** (line 179): derived — `activeSection === 'analysis' && analysisTab === 'measure' && !designMode`
- When `measureActive`, passes `onmeasured` callback to MapCanvas (line 677), which threads it to DrawingToolbar
- Clears `measureResult` when leaving measurement mode (line 183)
- "Measure Feature" action in DrawActionRow (line 722-728): calls `measureLine`/`measurePolygon` directly on selected feature geometry, then switches to analysis/measure tab
- GeoprocessingPanel mounted at line 870 with `embedded` prop, receives `layers={layersStore.all}`
- `onlayercreated` callback (line 875-882) logs activity event `'geoprocessing.completed'`

### 1.5 MapCanvas.svelte (Measurement Rendering)

**File:** `apps/web/src/lib/components/map/MapCanvas.svelte`

- Renders measurement annotation geometries as MapLibre layers (lines 884-911): dashed lines (`MEASURE_LINE_PAINT`), semi-transparent fills (`MEASURE_FILL_PAINT`), and text labels (`MEASURE_LABEL_LAYOUT/PAINT`)
- Passes `onmeasured` prop through to DrawingToolbar (line 957)

### 1.6 ActivityFeed.svelte (Logging)

**File:** `apps/web/src/lib/components/map/ActivityFeed.svelte`

- Geoprocessing completions appear in the activity feed under the "imports" filter category (line 35)
- Event type `'geoprocessing.completed'` renders as "Ran {operation} -> {outputLayerName}" (line 151-154)

---

## 2. Server-Side Components

### 2.1 tRPC Router — geoprocessingRouter

**File:** `apps/web/src/lib/server/trpc/routers/geoprocessing.ts`

Single mutation: `geoprocessing.run`

| Step | What | Line |
|------|------|------|
| Auth | `requireMapAccess(userId, mapId, 'editor')` — editor+ role required | 27 |
| Layer ownership | `getOpLayerIds(op)` returns source layer IDs; each verified against `mapId` via DB query | 31-44 |
| Cross-field validation | Aggregate sum/avg require non-empty `field` (Zod can't enforce across discriminated union) | 46-57 |
| z_index | Queries max existing z_index, new layer gets `maxZ + 1` | 59-65 |
| Layer creation | Inserts output layer with `type: 'mixed'` (geometry type may change, e.g. buffer: point to polygon) | 67-80 |
| Execution | `runGeoprocessing(op, newLayer.id)` | 88 |
| Rollback on failure | Deletes the empty output layer on error, wraps as `INTERNAL_SERVER_ERROR` | 89-97 |
| Return | `{ layerId, layerName }` | 99 |

**Mounted at:** `appRouter.geoprocessing` in `apps/web/src/lib/server/trpc/router.ts:23`

### 2.2 PostGIS Execution Engine — geoprocessing.ts

**File:** `apps/web/src/lib/server/geo/geoprocessing.ts`

Public API:
- `runGeoprocessing(op: GeoprocessingOp, newLayerId: string): Promise<void>` — dispatches via switch on `op.type` with `assertNever` exhaustiveness guard
- `getOpLayerIds(op: GeoprocessingOp): string[]` — returns source layer IDs for ownership verification

Uses `drizzle-orm`'s `sql` tagged template for parameterized queries — all user inputs (`layerId`, `distanceM`, `field`) are bound parameters, not string-interpolated.

### 2.3 Access Control — access.ts

**File:** `apps/web/src/lib/server/geo/access.ts`

- `requireMapAccess(userId, mapId, minRole)` — role hierarchy: viewer(0) < commenter(1) < editor(2)
- Owner fast-path: always granted regardless of `minRole`
- Non-collaborators receive `NOT_FOUND` (map existence hidden)
- Insufficient role receives `FORBIDDEN`

---

## 3. PostGIS Operations Reference

All operations follow the same pattern: `INSERT INTO features ... SELECT ... FROM features WHERE layer_id = ?`. Results go into a pre-created output layer.

| # | Operation | PostGIS Function | Input Layers | Parameters | Lines |
|---|-----------|-----------------|--------------|------------|-------|
| 1 | **Buffer** | `ST_Buffer(geometry::geography, distanceM)::geometry` | 1 | `distanceKm` (converted to meters) | 93-102 |
| 2 | **Convex Hull** | `ST_ConvexHull(ST_Collect(geometry))` | 1 | none (aggregates all features) | 105-112 |
| 3 | **Centroid** | `ST_Centroid(geometry)` | 1 | none (per-feature) | 115-121 |
| 4 | **Dissolve** | `ST_Union(geometry)` | 1 | optional `field` for group-dissolve | 124-151 |
| 5 | **Intersect** | `ST_Intersection(a.geometry, b.geometry)` | 2 | none; filters by `ST_Intersects` + not-empty | 153-171 |
| 6 | **Union** | `ST_Union(geometry)` | 1 | none (all features merged) | 173-180 |
| 7 | **Clip** | `ST_Intersection(a.geometry, mask.geom)` | 2 | layer B unioned as clip mask | 183-201 |

### Spatial Joins

| # | Join Type | Technique | Lines |
|---|-----------|-----------|-------|
| 8 | **Point-in-Polygon** | `LEFT JOIN ... ST_Within(p.geometry, poly.geometry)`, `DISTINCT ON (p.id)` | 210-231 |
| 9 | **Nearest Neighbor** | `CROSS JOIN LATERAL ... ORDER BY a.geometry <-> b.geometry LIMIT 1` (KNN index) | 238-259 |

### Aggregation

| # | Aggregation | SQL | Lines |
|---|-------------|-----|-------|
| 10a | **Count** | `COUNT(pt.id)` per polygon via `LEFT JOIN + ST_Within + GROUP BY` | 270-283 |
| 10b | **Sum** | `SUM((pt.properties->>field)::numeric)` with `COALESCE(..., 0)` | 284-300 |
| 10c | **Avg** | `AVG((pt.properties->>field)::numeric)` | 301-318 |

All aggregations use `LEFT JOIN` so polygons with no contained points still appear in output (with 0/NULL).

---

## 4. Type System — Shared Schemas

**File:** `packages/shared-types/src/schemas/geoprocessing.ts`

Zod discriminated union (`GeoprocessingOpSchema`) with 10 members keyed on `type`. Each schema enforces:
- UUIDs for layer IDs
- `distanceKm`: positive, max 1000
- `field`: string 1-255 chars, optional
- Aggregate `field` required for sum/avg — enforced via `.refine()` on `GeoAggregateOpSchema`, but the base schema (without refine) is used in the discriminated union (Zod limitation: `ZodEffects` has no `.shape` accessor). Router enforces field invariant at line 46-57.

Exports:
- 10 individual op type aliases (`GeoBufferOp`, `GeoConvexHullOp`, etc.)
- `GeoprocessingOp` union type
- `GEO_OP_LABELS: Record<GeoprocessingOp['type'], string>` — UI display names

---

## 5. Measurement System (Client-Side)

### 5.1 geo-engine/measurement.ts

**File:** `packages/geo-engine/src/measurement.ts`

Pure client-side Turf.js computations. Exported from `@felt-like-it/geo-engine` barrel (`packages/geo-engine/src/index.ts`).

| Function | Input | Output | Turf.js API |
|----------|-------|--------|-------------|
| `measureLine(coords)` | `[number, number][]` (2+ points) | `DistanceMeasurement` (distanceKm, vertexCount) | `turfLength(lineString, {units: 'kilometers'})` |
| `measurePolygon(coords)` | `[number, number][][]` (rings, 4+ outer ring points) | `AreaMeasurement` (areaM2, perimeterKm, vertexCount) | `turfArea(polygon)` + `turfLength(outerRing)` |
| `formatDistance(km, unit)` | km + target unit | locale-aware string | `convertLength` |
| `formatArea(m2, unit)` | m2 + target unit | locale-aware string | `convertArea` |

Unit types: `DistanceUnit = 'km' | 'mi' | 'm' | 'ft'`, `AreaUnit = 'km2' | 'mi2' | 'ha' | 'ac' | 'm2'`

Constants: `DISTANCE_UNITS` and `AREA_UNITS` — ordered arrays for unit-selector dropdowns.

Adaptive formatting: `adaptiveFormat()` adjusts decimal places by magnitude (0 for 10k+, 1 for 100+, 3 for 1+, 5 for 0.001+, 8 for smaller).

---

## 6. State Management

### 6.1 Interaction Modes Store

**File:** `apps/web/src/lib/stores/interaction-modes.svelte.ts`

The `InteractionState` discriminated union includes a `pendingMeasurement` variant (line 21-30) that carries measurement anchor geometry and content (type, value, unit, displayValue). This state is used when saving a measurement as an annotation — `MeasurementPanel.onsaveasannotation` triggers `transitionTo({ type: 'pendingMeasurement', ... })`.

Other relevant states: `idle`, `featureSelected`, `drawRegion`, `pickFeature`.

### 6.2 MapEditor Local State

No dedicated geoprocessing store exists. All geoprocessing state is local to the MapEditor component:
- `measureResult: MeasurementResult | null` — ephemeral, cleared on tab change
- `analysisTab: 'measure' | 'process'` — tab toggle
- `measureActive` — derived signal controlling measurement mode on the map canvas

The GeoprocessingPanel manages its own local form state (opType, layerIdA/B, distanceKm, dissolveField, aggregation, etc.) via Svelte `$state()` runes.

---

## 7. Test Coverage

### 7.1 geoprocessing.test.ts

**File:** `apps/web/src/__tests__/geoprocessing.test.ts`

Tests the tRPC router (not raw SQL). Uses vitest mocks for `db` and `runGeoprocessing`.

| Suite | Cases |
|-------|-------|
| Single-layer ops | buffer (creates layer + runs op), centroid, NOT_FOUND for wrong map, NOT_FOUND for missing layer, buffer distanceKm positive validation, buffer distanceKm max 1000 validation |
| Two-layer ops | intersect (creates layer + runs op), NOT_FOUND when one input layer missing |

### 7.2 measurement.test.ts

**File:** `packages/geo-engine/src/__tests__/measurement.test.ts`

| Suite | Cases |
|-------|-------|
| `measureLine` | single point (zero distance), 1 degree longitude (~111km), multi-segment, 1 degree latitude, type check |
| `measurePolygon` | type check, equatorial square area (~12k km2), perimeter (~444km), vertex count excludes closing duplicate, degenerate polygon, empty coordinates |
| `formatDistance` | km, mi, m, ft, comma separator for large numbers |
| `formatArea` | m2, km2, ha, ac, mi2 |
| Unit arrays | DISTANCE_UNITS contains all 4, AREA_UNITS contains all 5 |

---

## Proposed Seeds

```json
[
  {
    "title": "Geoprocessing: Add progress indication for long-running PostGIS operations",
    "type": "enhancement",
    "labels": ["geoprocessing", "ux"],
    "description": "Currently geoprocessing operations run synchronously with no timeout or progress feedback beyond a spinner. Large datasets could take significant time. Consider: server-sent events for progress, statement_timeout in PostGIS, or async job queue."
  },
  {
    "title": "Geoprocessing: Intersect uses CROSS JOIN which is O(n*m) without spatial index filtering",
    "type": "bug",
    "labels": ["geoprocessing", "performance"],
    "description": "runIntersect at geoprocessing.ts:158 uses CROSS JOIN filtered by ST_Intersects. For large layers this is O(n*m). Consider using ST_Intersects in a JOIN ON clause to leverage spatial indexes, or add an explicit spatial index check."
  },
  {
    "title": "Geoprocessing: Aggregate field-required validation is split between Zod schema and router",
    "type": "tech-debt",
    "labels": ["geoprocessing", "types"],
    "description": "GeoAggregateOpSchema.refine() enforces field-required for sum/avg, but the discriminated union uses GeoAggregateBaseSchema (without refine) because ZodEffects lacks .shape. The router duplicates this check at line 46-57. This split validation could be unified if Zod adds discriminatedUnion support for refined schemas."
  }
]
```
