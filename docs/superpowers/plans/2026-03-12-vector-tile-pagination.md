# Vector Tile Pagination Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make large layers (>10k features) resilient by serving map tiles via Martin and paginating the DataTable with viewport-based loading.

**Architecture:** MapCanvas already has complete vector tile rendering support gated on `layer.featureCount`. This plan wires the missing pieces: populating `featureCount` from the server, adding a paginated+bbox-filtered `features.listPaged` endpoint, skipping bulk GeoJSON loading for large layers, and adding server-side pagination to DataTable with viewport tracking.

**Tech Stack:** SvelteKit, tRPC 11, Drizzle ORM, PostGIS, Martin vector tile server, MapLibre GL JS, Svelte 5 runes

**Spec:** `docs/superpowers/specs/2026-03-12-vector-tile-pagination-design.md`

---

## Chunk 1: Server-Side (featureCount + listPaged endpoint)

### Task 1: Add featureCount to layers.list response

**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/layers.ts` (the `list` query)
- Test: `apps/web/src/__tests__/layers.test.ts`

The `Layer` type in `shared-types` already supports `featureCount` as optional (MapCanvas uses `layer.featureCount ?? 0`). We just need to populate it from the server.

- [ ] **Step 1: Write failing test for featureCount in layers.list**

In `apps/web/src/__tests__/layers.test.ts`, add a test that asserts `layers.list` returns `featureCount` for each layer. Follow the existing test pattern in this file (mock db, mock `requireMapAccess`).

```typescript
it('includes featureCount for each layer', async () => {
  // Mock layers.list to return a layer
  const mockLayer = {
    id: 'layer-1',
    mapId: 'map-1',
    name: 'Test Layer',
    type: 'point',
    visible: true,
    zIndex: 0,
    style: {},
    sourceFileName: 'test.geojson',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // db.select chain returns layers
  mockSelect.mockReturnValueOnce(drizzleChain([mockLayer]));
  // db.execute returns feature count
  mockExecute.mockResolvedValueOnce(
    mockExecuteResult([{ layer_id: 'layer-1', feature_count: 42 }])
  );

  const result = await caller.layers.list({ mapId: 'map-1' });

  expect(result).toHaveLength(1);
  // Assert featureCount matches what the count query returned (not a magic literal)
  const expectedCount = 42;
  expect(result[0]?.featureCount).toBe(expectedCount);
});

it('returns featureCount 0 for layers with no features', async () => {
  const mockLayer = {
    id: 'layer-empty',
    mapId: 'map-1',
    name: 'Empty Layer',
    type: 'point',
    visible: true,
    zIndex: 0,
    style: {},
    sourceFileName: 'empty.geojson',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  mockSelect.mockReturnValueOnce(drizzleChain([mockLayer]));
  // Count query returns no rows for this layer
  mockExecute.mockResolvedValueOnce(mockExecuteResult([]));

  const result = await caller.layers.list({ mapId: 'map-1' });

  expect(result).toHaveLength(1);
  expect(result[0]?.featureCount).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx vitest run src/__tests__/layers.test.ts -t "includes featureCount"`
Expected: FAIL — `featureCount` is undefined because layers.list doesn't return it yet.

- [ ] **Step 3: Implement featureCount in layers.list**

In `apps/web/src/lib/server/trpc/routers/layers.ts`, modify the `list` procedure. After fetching layers, run a single COUNT query grouped by layer_id and merge results:

```typescript
// After the existing layers query:
const layerRows = await db
  .select(/* existing fields */)
  .from(layers)
  .where(eq(layers.mapId, input.mapId))
  .orderBy(asc(layers.zIndex));

// Feature counts in one query
const counts = await db.execute(sql`
  SELECT layer_id, COUNT(*)::int AS feature_count
  FROM features
  WHERE layer_id = ANY(${layerRows.map((l) => l.id)})
  GROUP BY layer_id
`);

const countMap = new Map(
  counts.rows.map((r) => [r['layer_id'] as string, r['feature_count'] as number])
);

return layerRows.map((l) => ({
  ...l,
  featureCount: countMap.get(l.id) ?? 0,
}));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx vitest run src/__tests__/layers.test.ts -t "includes featureCount"`
Expected: PASS

- [ ] **Step 5: Run full layers test suite**

Run: `cd apps/web && npx vitest run src/__tests__/layers.test.ts`
Expected: All tests pass. Fix any broken tests caused by the new `db.execute` call (existing tests may need an additional mock for the count query).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/layers.ts apps/web/src/__tests__/layers.test.ts
git commit -m "feat(layers): include featureCount in layers.list response"
```

---

### Task 2: Add spatial index migration

**Files:**
- Create: `apps/web/src/lib/server/db/migrations/0013_feature_spatial_index.sql`

Check existing indexes first. The `features.listPaged` endpoint will use `ST_Intersects` with bbox filtering — needs a GIST index.

- [ ] **Step 1: Check existing indexes and migration numbering**

Run: `grep -r 'CREATE INDEX' apps/web/src/lib/server/db/migrations/ | grep -i 'feature\|geometry\|gist'`
If a GIST index on `features.geometry` already exists, skip this task.
Also run: `ls apps/web/src/lib/server/db/migrations/` to confirm the next available migration number (might not be 0013).

- [ ] **Step 2: Create migration file**

Use the next available migration number. Example assumes 0013:

```sql
-- Add spatial index for viewport-based feature queries
-- Used by features.listPaged with ST_Intersects bbox filter
CREATE INDEX IF NOT EXISTS idx_features_geometry_gist
  ON features USING GIST (geometry);

-- Composite index for layer_id + created_at (pagination ordering)
CREATE INDEX IF NOT EXISTS idx_features_layer_created
  ON features (layer_id, created_at);
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/server/db/migrations/0013_feature_spatial_index.sql
git commit -m "feat(db): add spatial and pagination indexes for features"
```

---

### Task 3: Add features.listPaged endpoint

**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/features.ts`
- Create: `apps/web/src/__tests__/features-paged.test.ts`

- [ ] **Step 1: Write failing tests for listPaged**

Create `apps/web/src/__tests__/features-paged.test.ts`. Follow the existing mock pattern from `features.test.ts` (mock db module, mock requireMapAccess). Test these cases:

```typescript
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drizzleChain, mockExecuteResult, mockContext } from './test-utils.js';

// Mock db module
const mockSelect = vi.fn();
const mockExecute = vi.fn();
vi.mock('$lib/server/db/index.js', () => ({
  db: {
    select: mockSelect,
    execute: mockExecute,
  },
  layers: { id: 'id', mapId: 'mapId' },
  features: { id: 'id', layerId: 'layerId' },
}));

vi.mock('$lib/server/geo/access.js', () => ({
  requireMapAccess: vi.fn(),
}));

describe('features.listPaged', () => {
  const ctx = mockContext();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns paginated rows with total count', async () => {
    // Mock layer lookup
    mockSelect.mockReturnValueOnce(
      drizzleChain([{ id: 'layer-1', mapId: 'map-1' }])
    );
    // Mock count query
    mockExecute.mockResolvedValueOnce(
      mockExecuteResult([{ total: 150 }])
    );
    // Mock features query
    mockExecute.mockResolvedValueOnce(
      mockExecuteResult([
        { id: 'f1', properties: { name: 'A' }, geometry_type: 'ST_Point', created_at: new Date(), updated_at: new Date() },
        { id: 'f2', properties: { name: 'B' }, geometry_type: 'ST_Point', created_at: new Date(), updated_at: new Date() },
      ])
    );

    const { featuresRouter } = await import('$lib/server/trpc/routers/features.js');
    // ... create caller, invoke listPaged
    const result = await caller.features.listPaged({
      layerId: 'layer-1',
      limit: 50,
      offset: 0,
    });

    expect(result.total).toBe(150);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toHaveProperty('id', 'f1');
    expect(result.rows[0]).toHaveProperty('geometryType', 'ST_Point');
  });

  it('applies bbox filter with ST_Intersects', async () => {
    mockSelect.mockReturnValueOnce(
      drizzleChain([{ id: 'layer-1', mapId: 'map-1' }])
    );
    mockExecute.mockResolvedValueOnce(mockExecuteResult([{ total: 5 }]));
    mockExecute.mockResolvedValueOnce(
      mockExecuteResult([
        { id: 'f1', properties: {}, geometry_type: 'ST_Point', created_at: new Date(), updated_at: new Date() },
      ])
    );

    const result = await caller.features.listPaged({
      layerId: 'layer-1',
      bbox: [-122.5, 37.5, -122.0, 38.0],
      limit: 50,
      offset: 0,
    });

    expect(result.total).toBe(5);
    // Verify the SQL contained ST_MakeEnvelope by checking execute was called
    expect(mockExecute).toHaveBeenCalledTimes(2); // count + rows
  });

  it('rejects invalid sortBy values', async () => {
    await expect(
      caller.features.listPaged({
        layerId: 'layer-1',
        sortBy: 'DROP TABLE features' as never,
        limit: 50,
        offset: 0,
      })
    ).rejects.toThrow(); // Zod enum validation
  });

  it('returns empty rows for zero results', async () => {
    mockSelect.mockReturnValueOnce(
      drizzleChain([{ id: 'layer-1', mapId: 'map-1' }])
    );
    mockExecute.mockResolvedValueOnce(mockExecuteResult([{ total: 0 }]));
    mockExecute.mockResolvedValueOnce(mockExecuteResult([]));

    const result = await caller.features.listPaged({
      layerId: 'layer-1',
      limit: 50,
      offset: 0,
    });

    expect(result.total).toBe(0);
    expect(result.rows).toEqual([]);
  });

  it('throws NOT_FOUND for nonexistent layer', async () => {
    mockSelect.mockReturnValueOnce(drizzleChain([]));

    await expect(
      caller.features.listPaged({ layerId: 'no-such-layer', limit: 50, offset: 0 })
    ).rejects.toThrow('Layer not found');
  });

  it('clamps limit to max 200', async () => {
    await expect(
      caller.features.listPaged({ layerId: 'layer-1', limit: 999, offset: 0 })
    ).rejects.toThrow(); // Zod max(200) validation
  });

  it('handles offset beyond total gracefully', async () => {
    mockSelect.mockReturnValueOnce(
      drizzleChain([{ id: 'layer-1', mapId: 'map-1' }])
    );
    mockExecute.mockResolvedValueOnce(mockExecuteResult([{ total: 10 }]));
    mockExecute.mockResolvedValueOnce(mockExecuteResult([])); // offset past end

    const result = await caller.features.listPaged({
      layerId: 'layer-1',
      limit: 50,
      offset: 9999,
    });

    expect(result.total).toBe(10);
    expect(result.rows).toEqual([]);
  });
});
```

Adapt the test setup to follow the exact caller creation pattern from the existing `features.test.ts` — import the router, create a caller with `mockContext()`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx vitest run src/__tests__/features-paged.test.ts`
Expected: FAIL — `listPaged` procedure does not exist yet.

- [ ] **Step 3: Implement features.listPaged**

In `apps/web/src/lib/server/trpc/routers/features.ts`, add:

```typescript
/** Paginated feature rows with optional bbox filter (for large-layer DataTable) */
listPaged: protectedProcedure
  .input(
    z.object({
      layerId: z.string().uuid(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().min(0).default(0),
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
      sortBy: z.enum(['created_at', 'updated_at', 'id']).default('created_at'),
      sortDir: z.enum(['asc', 'desc']).default('asc'),
    })
  )
  .query(async ({ ctx, input }) => {
    // Look up layer → map for access check
    const [layer] = await db
      .select({ id: layers.id, mapId: layers.mapId })
      .from(layers)
      .where(eq(layers.id, input.layerId));

    if (!layer) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Layer not found.' });
    }

    await requireMapAccess(ctx.user.id, layer.mapId, 'viewer');

    // Build WHERE clause
    const conditions = [sql`layer_id = ${input.layerId}`];
    if (input.bbox) {
      const [west, south, east, north] = input.bbox;
      conditions.push(
        sql`ST_Intersects(geometry, ST_MakeEnvelope(${west}, ${south}, ${east}, ${north}, 4326))`
      );
    }

    const whereClause = sql.join(conditions, sql` AND `);

    // Sort column — sql.raw() is safe here because sortBy is validated by
    // z.enum(['created_at', 'updated_at', 'id']). Do NOT expand this enum
    // without verifying the new value is a real column name.
    const orderExpr =
      input.sortDir === 'desc'
        ? sql`${sql.raw(input.sortBy)} DESC`
        : sql`${sql.raw(input.sortBy)} ASC`;

    // Count query
    const [countResult] = (
      await db.execute(sql`SELECT COUNT(*)::int AS total FROM features WHERE ${whereClause}`)
    ).rows;
    const total = (countResult?.['total'] as number) ?? 0;

    // Data query — no full geometry, just metadata for DataTable
    const rows = await db.execute(sql`
      SELECT id, properties, ST_GeometryType(geometry) AS geometry_type,
             created_at, updated_at
      FROM features
      WHERE ${whereClause}
      ORDER BY ${orderExpr}
      LIMIT ${input.limit} OFFSET ${input.offset}
    `);

    return {
      total,
      rows: rows.rows.map((r) => ({
        id: r['id'] as string,
        properties: r['properties'] as Record<string, unknown>,
        geometryType: r['geometry_type'] as string,
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
      })),
    };
  }),
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx vitest run src/__tests__/features-paged.test.ts`
Expected: All pass.

- [ ] **Step 5: Run full test suite**

Run: `cd apps/web && npx vitest run src/__tests__/features*.test.ts`
Expected: All pass (both original features tests and new paged tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/features.ts apps/web/src/__tests__/features-paged.test.ts
git commit -m "feat(features): add listPaged endpoint with bbox filter and pagination"
```

---

## Chunk 2: Client-Side (MapEditor + DataTable + Viewport Loading)

### Task 4: Skip GeoJSON loading for large layers in MapEditor

**Files:**
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`

MapCanvas already renders vector tiles when `layer.featureCount > 10_000`. But MapEditor still calls `loadLayerData(layer.id)` for every layer, which fetches ALL features via `features.list`. For large layers, this must be skipped.

- [ ] **Step 1: Import VECTOR_TILE_THRESHOLD and PUBLIC_MARTIN_URL**

At the top of MapEditor's `<script>` block, add:

```typescript
import { PUBLIC_MARTIN_URL } from '$env/static/public';

const VECTOR_TILE_THRESHOLD = 10_000;

function isLargeLayer(layer: Layer): boolean {
  return PUBLIC_MARTIN_URL.length > 0 && (layer.featureCount ?? 0) > VECTOR_TILE_THRESHOLD;
}
```

- [ ] **Step 2: Guard loadLayerData calls**

In the `$effect` that calls `loadLayerData` for all layers on init:

```typescript
// Before (around line 277):
for (const layer of layers) {
  loadLayerData(layer.id);
}

// After:
for (const layer of layers) {
  if (!isLargeLayer(layer)) {
    loadLayerData(layer.id);
  }
}
```

Also guard `handleLayerChange()` (around line 303):

```typescript
async function handleLayerChange() {
  const activeLayer = layersStore.active;
  if (!activeLayer) return;
  if (isLargeLayer(activeLayer)) return; // vector tiles handle rendering
  if (!layerData[activeLayer.id]) {
    await loadLayerData(activeLayer.id);
  }
}
```

And `handleImportComplete` — after import, re-fetch layers list to get updated featureCount:

```typescript
async function handleImportComplete(layerId: string) {
  // Re-fetch layers to get updated featureCount
  const updatedLayers = await trpc.layers.list.query({ mapId: mapStore.mapId! });
  layersStore.set(updatedLayers);

  const layer = updatedLayers.find((l) => l.id === layerId);
  if (layer && !isLargeLayer(layer)) {
    await loadLayerData(layerId);
  }
}
```

- [ ] **Step 3: Verify consistency between MapEditor and MapCanvas thresholds**

Confirm that MapCanvas's `usesVectorTiles()` (in `MapCanvas.svelte:~148-161`) uses the same `VECTOR_TILE_THRESHOLD = 10_000` and `PUBLIC_MARTIN_URL` guard as the new `isLargeLayer()` in MapEditor. Both must agree, or a layer could be "large" in the editor but rendered as GeoJSON in the canvas (or vice versa).

**Important**: `VECTOR_TILE_THRESHOLD` is now duplicated in MapEditor and MapCanvas. Extract it to a shared constant (e.g., `$lib/utils/constants.ts`) to prevent drift. Both files should import from the same source.

Also verify `layersStore` passes `featureCount` through: check that `layersStore.set()` and `layersStore.update()` don't strip unknown properties. Since the store uses spread (`{ ...l, ...patch }`), `featureCount` will pass through as long as the `Layer` type includes it.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/map/MapEditor.svelte
git commit -m "feat(map): skip GeoJSON loading for large layers, rely on vector tiles"
```

---

### Task 5: Add server-side pagination mode to DataTable

**Files:**
- Modify: `apps/web/src/lib/components/data/DataTable.svelte`

- [ ] **Step 1: Add server-side mode props**

DataTable currently receives `features: GeoJSONFeature[]` and does everything client-side. Add an alternative server-side mode:

```typescript
// New props alongside existing ones:
interface Props {
  // Existing props (client mode):
  features?: GeoJSONFeature[];
  layerStyle?: LayerStyle;

  // Server mode props:
  mode?: 'client' | 'server';
  serverRows?: Array<{ id: string; properties: Record<string, unknown>; geometryType: string }>;
  serverTotal?: number;
  serverPage?: number;
  serverPageSize?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  onSortChange?: (sortBy: string, sortDir: 'asc' | 'desc') => void;
}

let {
  features = [],
  layerStyle,
  mode = 'client',
  serverRows = [],
  serverTotal = 0,
  serverPage = 1,
  serverPageSize = 50,
  onPageChange,
  onPageSizeChange,
  onSortChange,
}: Props = $props();
```

- [ ] **Step 2: Add pagination UI**

Below the table `<tbody>`, add pagination controls that only show in server mode:

```svelte
{#if mode === 'server'}
  <div class="flex items-center justify-between px-3 py-2 border-t border-white/10 text-xs text-slate-300">
    <span>
      {#if serverTotal > 0}
        Showing {(serverPage - 1) * serverPageSize + 1}–{Math.min(serverPage * serverPageSize, serverTotal)} of {serverTotal} features in viewport
      {:else}
        No features in current viewport
      {/if}
    </span>
    <div class="flex items-center gap-2">
      <select
        class="bg-slate-700 border border-white/10 rounded px-1 py-0.5 text-xs"
        value={serverPageSize}
        onchange={(e) => onPageSizeChange?.(Number((e.target as HTMLSelectElement).value))}
      >
        <option value={25}>25</option>
        <option value={50}>50</option>
        <option value={100}>100</option>
      </select>
      <button
        class="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
        disabled={serverPage <= 1}
        onclick={() => onPageChange?.(serverPage - 1)}
      >Prev</button>
      <span>{serverPage} / {Math.max(1, Math.ceil(serverTotal / serverPageSize))}</span>
      <button
        class="px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-40"
        disabled={serverPage * serverPageSize >= serverTotal}
        onclick={() => onPageChange?.(serverPage + 1)}
      >Next</button>
    </div>
  </div>
{/if}
```

- [ ] **Step 3: Wire server rows into the table body**

In the table rendering, switch data source based on mode:

```typescript
// Computed rows for table rendering
const displayRows = $derived(
  mode === 'server'
    ? serverRows.map((r) => ({
        type: 'Feature' as const,
        id: r.id,
        geometry: {} as Record<string, unknown>,
        properties: { ...r.properties, _id: r.id },
      }))
    : filteredFeatures // existing client-side filtered/sorted features
);
```

Use `displayRows` in the `{#each}` loop instead of `filteredFeatures`.

- [ ] **Step 4: Wire sort clicks for server mode**

In the `toggleSort` function, add server-mode handling:

```typescript
function toggleSort(col: string) {
  if (mode === 'server') {
    // Map column name to sortBy enum value
    const serverSortable = ['created_at', 'updated_at', 'id'];
    if (serverSortable.includes(col)) {
      const newDir = sortKey === col && sortAsc ? 'desc' : 'asc';
      sortKey = col;
      sortAsc = newDir === 'asc';
      onSortChange?.(col, newDir);
    }
    return;
  }
  // existing client-side sort logic unchanged
  // ...
}
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/data/DataTable.svelte
git commit -m "feat(DataTable): add server-side pagination mode with page controls"
```

---

### Task 6: Wire viewport-based loading in MapEditor

**Files:**
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`

This is the key integration: when a large layer is active, listen to map viewport changes, debounce, and fetch paginated features for the DataTable.

- [ ] **Step 1: Add viewport state and pagination state**

```typescript
// Viewport-based pagination state for large layers
let viewportAbort: AbortController | null = null;
let viewportRows = $state<Array<{ id: string; properties: Record<string, unknown>; geometryType: string }>>([]);
let viewportTotal = $state(0);
let viewportPage = $state(1);
let viewportPageSize = $state(50);
let viewportSortBy = $state<'created_at' | 'updated_at' | 'id'>('created_at');
let viewportSortDir = $state<'asc' | 'desc'>('asc');
let viewportLoading = $state(false);
```

- [ ] **Step 2: Add viewport fetch function**

```typescript
async function fetchViewportFeatures() {
  const activeLayer = layersStore.active;
  if (!activeLayer || !isLargeLayer(activeLayer)) return;

  const map = mapStore.mapInstance;
  if (!map) return;

  const bounds = map.getBounds();
  const bbox: [number, number, number, number] = [
    bounds.getWest(),
    bounds.getSouth(),
    bounds.getEast(),
    bounds.getNorth(),
  ];

  // Cancel any in-flight request to prevent stale results overwriting fresh ones
  viewportAbort?.abort();
  const controller = new AbortController();
  viewportAbort = controller;

  viewportLoading = true;
  try {
    const result = await trpc.features.listPaged.query({
      layerId: activeLayer.id,
      bbox,
      limit: viewportPageSize,
      offset: (viewportPage - 1) * viewportPageSize,
      sortBy: viewportSortBy,
      sortDir: viewportSortDir,
    });
    // Only update state if this request wasn't superseded
    if (!controller.signal.aborted) {
      viewportRows = result.rows;
      viewportTotal = result.total;
    }
  } catch (err) {
    if (controller.signal.aborted) return; // Superseded — ignore
    console.error('[fetchViewportFeatures] failed:', err);
    toastStore.error('Failed to load features for viewport');
  } finally {
    viewportLoading = false;
  }
}
```

- [ ] **Step 3: Add debounced moveend listener**

```typescript
let moveEndTimer: ReturnType<typeof setTimeout> | undefined;

function handleMoveEnd() {
  clearTimeout(moveEndTimer);
  moveEndTimer = setTimeout(() => {
    viewportPage = 1; // Reset to page 1 on pan/zoom
    fetchViewportFeatures();
  }, 300);
}
```

Wire this into the MapCanvas component. MapCanvas likely exposes an `onmoveend` event or you can register directly on the map instance. Find the appropriate way to hook into it:

```typescript
// In the $effect that initializes the map or after mapStore.mapInstance is set:
$effect(() => {
  const map = mapStore.mapInstance;
  const activeLayer = layersStore.active;
  if (!map || !activeLayer || !isLargeLayer(activeLayer)) return;

  map.on('moveend', handleMoveEnd);
  // Initial fetch for current viewport
  fetchViewportFeatures();

  return () => {
    map.off('moveend', handleMoveEnd);
    clearTimeout(moveEndTimer);
  };
});
```

- [ ] **Step 4: Wire pagination callbacks**

```typescript
function handleViewportPageChange(page: number) {
  viewportPage = page;
  fetchViewportFeatures();
}

function handleViewportPageSizeChange(size: number) {
  viewportPageSize = size;
  viewportPage = 1;
  fetchViewportFeatures();
}

function handleViewportSortChange(sortBy: string, sortDir: 'asc' | 'desc') {
  viewportSortBy = sortBy as 'created_at' | 'updated_at' | 'id';
  viewportSortDir = sortDir;
  viewportPage = 1;
  fetchViewportFeatures();
}
```

- [ ] **Step 5: Pass server mode props to DataTable**

Find where DataTable is rendered in MapEditor (around line 593) and switch based on layer size:

```svelte
{#if layersStore.active && isLargeLayer(layersStore.active)}
  <DataTable
    mode="server"
    serverRows={viewportRows}
    serverTotal={viewportTotal}
    serverPage={viewportPage}
    serverPageSize={viewportPageSize}
    onPageChange={handleViewportPageChange}
    onPageSizeChange={handleViewportPageSizeChange}
    onSortChange={handleViewportSortChange}
  />
{:else}
  <DataTable
    features={filteredFeatures}
    layerStyle={layersStore.active?.style}
  />
{/if}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/map/MapEditor.svelte
git commit -m "feat(map): viewport-based DataTable loading for large layers"
```

---

### Task 7: Add editing restriction UI for large layers

**Files:**
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`

- [ ] **Step 1: Hide draw toolbar for large layers**

Find where `DrawingToolbar` is rendered and gate it:

```svelte
{#if layersStore.active && !isLargeLayer(layersStore.active) && canEdit}
  <DrawingToolbar ... />
{/if}
```

- [ ] **Step 2: Add large-layer indicator banner**

When a large layer is active, show a subtle info banner near the DataTable:

```svelte
{#if layersStore.active && isLargeLayer(layersStore.active)}
  <div class="px-3 py-1.5 bg-blue-900/30 border-b border-blue-500/20 text-xs text-blue-300 flex items-center gap-2">
    <svg class="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
    <span>Large layer ({(layersStore.active.featureCount ?? 0).toLocaleString()} features) — rendered via vector tiles. Use the table to inspect features.</span>
  </div>
{/if}
```

- [ ] **Step 3: Also hide FilterPanel for large layers**

The client-side FilterPanel won't work with server-paginated data:

```svelte
{#if showFilterPanel && !isLargeLayer(layersStore.active)}
  <FilterPanel layerId={activeLayer.id} features={rawFeatures} />
{/if}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/map/MapEditor.svelte
git commit -m "feat(map): hide editing tools and show info banner for large layers"
```

---

### Task 8: Manual integration verification

- [ ] **Step 1: Run full test suite**

```bash
cd apps/web && npx vitest run
```

All tests must pass.

- [ ] **Step 2: Run type check**

```bash
cd apps/web && npx tsc --noEmit
```

No type errors.

- [ ] **Step 3: Run lint**

```bash
cd apps/web && npx eslint src/
```

No new warnings/errors.

- [ ] **Step 4: Final commit if any fixes were needed**

Stage only the specific files that were fixed (avoid `git add -A`):

```bash
git add <fixed-files>
git commit -m "fix: resolve type/lint issues from vector tile pagination feature"
```
