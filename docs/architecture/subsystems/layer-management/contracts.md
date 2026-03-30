# Layer Management -- Contracts (L6)

## Type Definitions

All layer types originate from `@felt-like-it/shared-types` (single source of truth).

### Layer (Zod-inferred)

```
packages/shared-types/src/schemas/layer.ts → LayerSchema
```

| Field | Type | Notes |
|-------|------|-------|
| `id` | `string` (uuid) | PK |
| `mapId` | `string` (uuid) | FK to maps |
| `name` | `string` (1-200) | |
| `type` | `'point' \| 'line' \| 'polygon' \| 'mixed'` | LayerTypeSchema |
| `style` | `LayerStyle` | JSONB, defaults `{}` |
| `visible` | `boolean` | default `true` |
| `zIndex` | `number` (int, min 0) | ordering |
| `sourceFileName` | `string \| null` | import provenance |
| `featureCount` | `number?` | computed at query time (not stored) |
| `version` | `number` (int, positive) | optimistic concurrency, default `1` |
| `createdAt` | `Date` | |
| `updatedAt` | `Date` | |

### LayerStyle (Zod-inferred)

```
packages/shared-types/src/schemas/style.ts → LayerStyleSchema
```

| Field | Type | Notes |
|-------|------|-------|
| `version` | `string?` | FSL schema version |
| `type` | `'simple' \| 'categorical' \| 'numeric' \| 'graduated' \| 'heatmap'` | default `'simple'` |
| `config` | `StyleConfig?` | categoricalAttribute, numericAttribute, categories, steps, showOther, classificationMethod, numClasses, colorRampName, heatmapRadius/Intensity/WeightAttribute |
| `label` | `StyleLabel?` | visible, minZoom, maxZoom, color, haloColor, fontSize |
| `isClickable` | `boolean?` | suppress click events |
| `highlightColor` | `string?` | selected feature color |
| `showBehindLabels` | `boolean?` | FillLayer before first symbol |
| `paint` | `Record<string, unknown>?` | raw MapLibre paint properties |
| `legend` | `LegendEntry[]?` | label + color + optional value |

### Supporting Schemas

- **CreateLayerSchema:** `{ mapId, name, type? }` -- used by `layers.create`
- **UpdateLayerSchema:** `{ name?, style?, visible?, zIndex?, version? }` -- used by `layers.update`
- **LegendEntrySchema:** `{ label, color, value? }`
- **StyleConfigSchema:** Metadata for data-driven visualization
- **StyleLabelSchema:** Label rendering settings

## Database Schema

```
apps/web/src/lib/server/db/schema.ts → layers pgTable
```

| Column | DB Type | Constraint |
|--------|---------|------------|
| `id` | uuid | PK, defaultRandom |
| `map_id` | uuid | FK maps(id) CASCADE, NOT NULL |
| `name` | text | NOT NULL |
| `type` | text | NOT NULL, default 'mixed' |
| `style` | jsonb | NOT NULL, default '{}' |
| `visible` | boolean | NOT NULL, default true |
| `z_index` | integer | NOT NULL, default 0 |
| `source_file_name` | text | nullable |
| `version` | integer | NOT NULL, default 1 |
| `created_at` | timestamptz | NOT NULL, defaultNow |
| `updated_at` | timestamptz | NOT NULL, defaultNow |
| **Index:** `layers_map_id_idx` on `map_id` | | |

`LayerRow = typeof layers.$inferSelect` -- Drizzle inferred select type.

Feature cascade: `features.layer_id` references `layers.id` with `onDelete: 'cascade'`. Deleting a layer cascades to all its features.

## tRPC Router Contract

```
apps/web/src/lib/server/trpc/routers/layers.ts → layersRouter
```

All procedures use `protectedProcedure` (auth required).

| Procedure | Type | Input | Access | Notes |
|-----------|------|-------|--------|-------|
| `list` | query | `{ mapId }` | viewer+ | Raw SQL with feature count subquery |
| `create` | mutation | `CreateLayerSchema` | editor+ | Auto-assigns next zIndex |
| `update` | mutation | `{ id } + UpdateLayerSchema` | editor+ | Version-gated WHERE clause |
| `delete` | mutation | `{ id }` | editor+ | Cascades features via FK |
| `reorder` | mutation | `{ mapId, order: [{id, version}] }` | editor+ | Transactional, version-gated per row |

### Optimistic Concurrency Protocol

1. Every mutation that changes a layer bumps `version = version + 1` server-side.
2. `update` accepts optional `version` -- when provided, the WHERE clause includes `version = :version`. If no row matches, throws `CONFLICT`.
3. `reorder` requires `version` per entry. Runs in a DB transaction -- if any single row's version mismatches, the entire reorder aborts with `CONFLICT`.
4. Client catches `CONFLICT` (checks `err?.data?.code`) and shows a "modified by another user" toast.

## Boundary Crossings

### layersStore <-> MapCanvas
- MapCanvas reads `layersStore.all` reactively to build layer render configs.
- Each layer gets a `LayerRenderConfig`: `{ source, paintProps, usesVT, layerStyle }`.
- Style resolution: `styleStore.getStyle(layer.id) ?? layer.style` (ephemeral override wins).

### layersStore <-> useLayerDataManager
- `useLayerDataManager` calls `trpc.layers.list.query()` on mount and sets `layersStore.set(layers)`.
- Also auto-selects active layer and triggers feature loading.

### styleStore <-> MapCanvas
- MapCanvas derives paint properties from resolved style via `resolvePaintInterpolators()` from geo-engine.
- Paint objects are memoized via `$derived` to prevent infinite MapLibre re-render loops.

### layersStore <-> DrawingToolbar
- DrawingToolbar reads `layersStore.active` to know which layer to add features to.
- After feature upsert, invalidates TanStack `queryKeys.features.list({ layerId })`.

### Cache Coordination
- Feature data flows through TanStack Query (unified cache).
- `queryKeys.layers.list({ mapId })` for layer list.
- `queryKeys.features.list({ layerId })` for per-layer feature data.
- DrawingToolbar invalidation triggers MapEditor's `fetchQuery` to re-fetch.
