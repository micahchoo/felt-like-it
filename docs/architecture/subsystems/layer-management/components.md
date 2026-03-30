# Layer Management -- Components (L5)

## Subsystem Boundary

```
INSIDE layer-management:
  apps/web/src/lib/components/map/LayerPanel.svelte          (UI)
  apps/web/src/lib/components/style/StylePanel.svelte         (UI)
  apps/web/src/lib/components/style/Legend.svelte              (UI)
  apps/web/src/lib/stores/layers.svelte.ts                    (client state)
  apps/web/src/lib/stores/style.svelte.ts                     (client state)
  apps/web/src/lib/server/trpc/routers/layers.ts              (API)
  apps/web/src/lib/server/db/schema.ts → layers table         (persistence)
  packages/shared-types/src/schemas/layer.ts                  (shared contract)
  packages/shared-types/src/schemas/style.ts                  (shared contract)

NEIGHBOURS (cross-boundary):
  MapEditor.svelte           → orchestrates LayerPanel, StylePanel, Legend
  MapCanvas.svelte           → consumes layersStore.all + styleStore for rendering
  map-sources.svelte.ts      → hotOverlay per-layer ephemeral feature cache
  useLayerDataManager.svelte.ts → loads layer list, sets layersStore
  DrawingToolbar.svelte      → reads layersStore.active for feature mutations
  filterStore                → per-layer filter state
  undoStore                  → captures layer state in undo closures
```

## Component Responsibilities

### LayerPanel.svelte
- **Role:** Layer CRUD panel in sidebar. Owns create/delete/visibility-toggle/reorder UI.
- **Props:** `mapId: string`, `onlayerchange?: () => void`
- **State:** `creatingLayer`, `newLayerName`, `loadErrors`, `togglingIds` (Set for dedup)
- **tRPC calls:** `layers.create`, `layers.delete`, `layers.update` (visibility), `layers.reorder`
- **Store writes:** `layersStore.add/remove/toggle/reorder/setActive`, `styleStore.clearStyle`
- **Pattern:** Optimistic update on visibility toggle (revert on error). Non-optimistic on create (add after await).
- **Conflict handling:** Detects `CONFLICT` error code from version mismatch, shows reload toast.
- **Template:** Renders layer list sorted by zIndex, with type icons (point/line/polygon/mixed), visibility eye toggle, up/down reorder buttons, delete button, active layer highlight.

### StylePanel.svelte
- **Role:** Style editor panel. Edits paint properties, choropleth config, heatmap settings.
- **Props:** `layerFeatures?: GeoJSONFeature[]` (for choropleth attribute detection)
- **Derives:** current layer from `styleStore.editingLayerId` + `layersStore.all`
- **tRPC calls:** `layers.update` (with style + version for optimistic concurrency)
- **Store writes:** `styleStore.setStyle`, `layersStore.updateStyle` (always in tandem)
- **Rollback:** On save failure, reverts both stores to `lastSavedStyle` snapshot. Test: `style-panel-rollback.test.ts`.
- **Style types:** simple, categorical, numeric/graduated, heatmap

### Legend.svelte
- **Role:** Read-only legend display. Derives legend entries from `layersStore.all` layer styles.
- **Store reads:** `layersStore.all`, `styleStore.showLegend`
- **Store writes:** `styleStore.toggleLegend()`

### layersStore (stores/layers.svelte.ts)
- **Role:** Client-side layer state. Module-level singleton (Svelte 5 runes).
- **State:** `_layers: Layer[]`, `_activeLayerId: string | null`
- **API:**
  | Method | Purpose |
  |--------|---------|
  | `all` | All layers sorted by zIndex |
  | `active` | Active layer object (derived) |
  | `activeLayerId` | Active layer ID |
  | `set(layers)` | Replace all, sort by zIndex, auto-select first |
  | `add(layer)` | Append + sort + set active |
  | `update(id, patch)` | Partial update by ID |
  | `remove(id)` | Remove + fallback active to first |
  | `toggle(id)` | Toggle visible flag |
  | `setActive(id)` | Set active layer |
  | `updateStyle(id, style)` | Replace style on a layer |
  | `reorder(from, to)` | Splice + reassign zIndex |
  | `getOrderedIds()` | IDs in z-order |
  | `getOrderedIdsWithVersions()` | IDs + versions for versioned reorder |

### styleStore (stores/style.svelte.ts)
- **Role:** Ephemeral style overrides + legend/editing state.
- **State:** `_styleOverrides: Map<string, LayerStyle>`, `_showLegend`, `_editingLayerId`
- **API:**
  | Method | Purpose |
  |--------|---------|
  | `getStyle(layerId)` | Get override or null |
  | `setStyle(layerId, style)` | Set ephemeral override |
  | `clearStyle(layerId)` | Remove override |
  | `toggleLegend()` | Toggle legend visibility |
  | `setEditingLayer(id)` | Set which layer StylePanel edits |

### hotOverlay (utils/map-sources.svelte.ts)
- **Role:** Per-layer ephemeral feature cache for vector-tile layers. Drawn features appear instantly via hot GeoJSON overlay before tile rebuild.
- **State:** `_hotFeatures: Record<string, Feature[]>` keyed by layerId
- **API:** `getCollection(layerId)`, `addHotFeature`, `removeHotFeature`, `setSelectedHotFeature`, `clearHotFeatures`
- **Consumer:** MapCanvas renders hot overlay sublayers (Fill+Line+Circle) for each visible layer.

## Rendering Pipeline (MapCanvas)

```
layersStore.all (sorted by zIndex)
  → per layer: resolve style from styleStore.getStyle(id) ?? layer.style
  → resolvePaintInterpolators(config, zoom) → MapLibre paint expressions
  → 3 sublayers per source: FillLayer + LineLayer + CircleLayer
  → MapLibre routes geometry type to matching sublayer
  → hotOverlay: additional GeoJSON sources for VT layers with drawn features
```

Paint expressions are cached via `$derived` to avoid infinite re-render loops (MapLibre compares by reference).
