# Vector Tile Rendering + Paginated Features + Viewport Loading

**Date**: 2026-03-12
**Status**: Approved

## Problem

`features.list` returns all features for a layer as a single GeoJSON FeatureCollection with no limit. A layer with 50k features (easily created via the import pipeline) will:
- Serialize ~50MB+ of JSON on the server
- Transfer it over the wire in one response
- Parse it into a single `layerData` state object
- Render 50k `<tr>` elements in DataTable (DOM explosion)
- Hold all geometry in a MapLibre GeoJSON source (memory pressure)

Martin vector tile server is already deployed and configured. MapCanvas.svelte already has partial vector tile support (VectorTileSource, VECTOR_TILE_THRESHOLD, sublayer rendering) but it is not wired to the feature-count decision path or the DataTable.

## Design

### Overview

Introduce a feature-count threshold. Below it, the current GeoJSON path works as-is. Above it, the map renders via Martin vector tiles and the DataTable uses a new paginated, bbox-filtered endpoint tied to the map viewport.

**Threshold**: `VECTOR_TILE_THRESHOLD = 10_000` (aligns with existing constant in MapCanvas.svelte and docker-compose comment).

### 1. Layer Feature Count

**Server**: Add `featureCount` to the `layers.list` response. Computed via a subquery:

```sql
SELECT l.*, (SELECT COUNT(*) FROM features f WHERE f.layer_id = l.id) AS feature_count
FROM layers l WHERE l.map_id = $mapId
```

**Type**: `featureCount` is NOT added to the base `Layer` Zod schema (it's not present on create/update). Instead, `layers.list` returns a response-only type `LayerWithCount` that extends `Layer` with `featureCount: number`.

**Client**: `layersStore` exposes `featureCount` per layer. MapEditor uses it to choose rendering path.

### 2. MapEditor Rendering Switch

```
if (layer.featureCount > VECTOR_TILE_THRESHOLD && PUBLIC_MARTIN_URL) {  // 10_000
  → add vector tile source from Martin
  → filter tiles by layer_id: ["==", ["get", "layer_id"], layerId]
  → disable draw/edit tools for this layer
  → show "Large layer — view only" indicator
} else {
  → current GeoJSON path (features.list → layerData state)
}
```

**Martin tile URL**: `${PUBLIC_MARTIN_URL}/public.features/{z}/{x}/{y}` (schema-qualified, per martin.yaml auto-publish config).

**Sublayer rendering**: Reuse existing style logic (Fill+Line+Circle sublayers) but with the vector tile source instead of GeoJSON source. The style properties are the same.

### 3. Paginated Features Endpoint

New `features.listPaged` procedure:

```typescript
features.listPaged
  .input(z.object({
    layerId: z.string().uuid(),
    limit: z.number().int().min(1).max(200).default(50),
    offset: z.number().int().min(0).default(0),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
    sortBy: z.enum(['created_at', 'updated_at', 'id']).default('created_at'),
    sortDir: z.enum(['asc', 'desc']).default('asc'),
  }))
```

**Query** (when bbox provided):
```sql
SELECT id, properties, ST_GeometryType(geometry) as geometry_type, created_at, updated_at
FROM features
WHERE layer_id = $layerId
  AND ST_Intersects(geometry, ST_MakeEnvelope($west, $south, $east, $north, 4326))
ORDER BY $sortBy $sortDir
LIMIT $limit OFFSET $offset
```

**Response**:
```typescript
{
  rows: Array<{ id: string; properties: Record<string, unknown>; geometryType: string }>;
  total: number;  // COUNT(*) with same WHERE (for pagination UI)
}
```

Note: Full geometry is NOT returned — Martin tiles handle rendering. Only `geometryType` for icon display in the table.

**Access control**: Same as `features.list` — look up the layer's `mapId`, then `requireMapAccess(userId, mapId, 'viewer')`.

**`sortBy` safety**: The enum allowlist (`created_at`, `updated_at`, `id`) prevents SQL injection. Sorting by property keys (JSONB) is a future enhancement requiring `properties->>$key` with explicit validation.

**COUNT performance**: The `total` count uses the same WHERE clause. For very large layers with bbox, this is a spatial count that benefits from the GIST index. If performance becomes an issue, return an estimate for non-paginated use cases. Acceptable for now.

**Index**: `CREATE INDEX idx_features_layer_geometry ON features USING GIST (geometry) WHERE layer_id IS NOT NULL;` — if not already present, add via migration.

### 4. DataTable Pagination

**Below threshold**: Current behavior — all features in memory, client-side sort/filter.

**Above threshold**: Server-side mode:
- DataTable receives `mode: 'server'` prop
- Page controls: prev/next + page number + page size selector (25/50/100)
- Sort clicks call `features.listPaged` with new `sortBy`/`sortDir`
- Filter text input does client-side filtering within the current page (server-side full-text search is a future enhancement)
- Shows "Showing X–Y of Z features in viewport" when bbox active, or "Showing X–Y of Z features" when no bbox

### 5. Viewport-Based Loading

When a large layer is active and the DataTable is visible:

1. MapEditor listens to MapLibre `moveend` event
2. Debounce 300ms, extract `map.getBounds()` as `[west, south, east, north]`
3. Call `features.listPaged({ layerId, bbox, limit: 50, offset: 0 })`
4. DataTable updates with viewport-scoped results
5. User paginates within the viewport results
6. Pan/zoom resets to page 1

**Feature click** (on vector tile): Use `map.queryRenderedFeatures(point, { layers: [sublayerIds] })`. Martin embeds the `properties` column as a JSONB string in tile attributes — parse it client-side for display in popover/sidebar. No round-trip needed.

**Empty viewport**: When bbox query returns 0 results, DataTable shows "No features in current viewport" empty state.

**Threshold transitions**: `featureCount` is fetched each time `layers.list` is called. After import completes, the layers store should be invalidated/re-fetched so the rendering mode updates if a layer crosses the threshold.

**Pagination stability**: OFFSET-based pagination resets to page 1 on pan/zoom. Cursor-based pagination is a future enhancement if needed.

### 6. Editing Restriction

Above threshold:
- Draw toolbar is hidden/disabled
- A subtle banner: "This layer has too many features for in-browser editing. Use the data table to inspect features."
- `features.upsert` and `features.delete` still work server-side (no API restriction) — the limitation is UI-only

## Files Changed

| File | Change |
|------|--------|
| `packages/shared-types/src/index.ts` | Add `LayerWithCount` response type |
| `apps/web/src/lib/server/trpc/routers/layers.ts` | Add featureCount subquery to `list` |
| `apps/web/src/lib/server/trpc/routers/features.ts` | Add `listPaged` procedure |
| `apps/web/src/lib/server/db/migrations/NNNN_*.sql` | Spatial index if missing |
| `apps/web/src/lib/components/map/MapEditor.svelte` | Rendering switch, viewport listener, edit restriction |
| `apps/web/src/lib/components/map/MapCanvas.svelte` | Wire existing VT support to featureCount decision |
| `apps/web/src/lib/components/data/DataTable.svelte` | Server-side pagination mode |
| `apps/web/src/lib/stores/layers.svelte.ts` | Expose featureCount |
| `apps/web/src/__tests__/features.test.ts` | Tests for listPaged |

## Not In Scope

- Editing features in large layers via the UI
- Server-side full-text search in DataTable
- Streaming/chunked GeoJSON loading
- Dynamic threshold adjustment per user/map
