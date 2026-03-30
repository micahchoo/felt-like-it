# Wave 1: MapCanvas Decomposition + Feature Interaction

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 887-line MapCanvas monolith into focused child components and add hover feedback on data features.

**Architecture:** Extract DataLayerRenderer (data sources+layers+hot overlay) and AnnotationRenderer (pins, regions, badges, measurements) as child components of MapCanvas. Add hover interaction using svelte-maplibre-gl's layer events (`onmouseenter`/`onmouseleave`) and `FeatureState` component for declarative highlight state. Keep existing paint-based selection highlight (works correctly; FeatureState conversion deferred to avoid ID-compatibility risk).

**Tech Stack:** Svelte 5 runes, svelte-maplibre-gl v1.0.3, MapLibre GL JS 5, TypeScript

**Seeds:** `felt-like-it-2b53` (F03), `felt-like-it-aab0` (F04)

---

## Flow Map

```
F03: Layer Rendering
  layersStore.all → [layerRenderCache $derived] → per-layer:
    → VectorTileSource OR GeoJSONSource
      → FillLayer + LineLayer + CircleLayer + SymbolLayer
      → (VT only) hot overlay GeoJSONSource
    → user sees data on map

F04: Feature Interaction
  user hovers feature → [layer onmouseenter] → cursor: pointer + hoveredFeature $state
    → FeatureState(source, id, {hover: true}) → paint expression highlights feature
  user leaves feature → [layer onmouseleave] → cursor: '' + hoveredFeature = null
    → FeatureState unmounts → highlight removed
  user clicks feature → [layer onclick] → handleFeatureClick
    → editorState.selectFeature() → Popup renders at click coords
```

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `apps/web/src/lib/components/map/DataLayerRenderer.svelte` | Create | Per-layer source+sublayer rendering loop, hot overlay, click/hover event forwarding |
| `apps/web/src/lib/components/map/AnnotationRenderer.svelte` | Create | Annotation pins, regions, badges, measurements, annotation popups |
| `apps/web/src/lib/components/map/map-styles.ts` | Modify | Add `getHoverAwarePaint()` with feature-state expressions |
| `apps/web/src/lib/components/map/MapCanvas.svelte` | Modify | Slim to ~200 LOC orchestrator using child components |
| `apps/web/src/__tests__/map-styles.test.ts` | Create | Tests for paint builders including hover-aware expressions |

## Conventions

- **Svelte 5 runes** — `$state`, `$derived`, `$effect` (not legacy stores)
- **exactOptionalPropertyTypes** — optional callback props use `| undefined`
- **Layer events** — svelte-maplibre-gl layer events provide `e.features[0]` (not MapMouseEvent)
- **FeatureState** — svelte-maplibre-gl's `FeatureState` component wraps `map.setFeatureState/removeFeatureState`; requires numeric feature ID or `promoteId` on source
- **Render cache** — paint/filter objects MUST be memoized ($derived.by) to avoid infinite re-render loops (new object reference → setPaintProperty → render → template re-eval → new object → loop)
- **queueMicrotask for state writes** — click handlers during Svelte 5 effect flush can exceed 1000-iteration depth limit; defer with `queueMicrotask()`

## svelte-maplibre-gl v1.0.3 API Reference

**Available (use these):**
- Layer props: `onclick`, `onmouseenter`, `onmouseleave`, `onmouseover`, `ondblclick`, `oncontextmenu`
- `FeatureState`: `{id, source, sourceLayer?, state}` — declarative feature state
- `Popup`: `{lnglat, closeButton, onclose, children}`
- `GeoJSONSource`: extends `GeoJSONSourceSpecification` (includes `promoteId`)
- `beforeId` prop on layers for z-ordering

**NOT available (do NOT use):**
- `manageHoverState`, `eventsIfTopMost`, `hoverCursor`, `beforeLayerType`
- Nested Popup-in-layer, `cluster` prop, `MarkerLayer`, `JoinedData`, `ZoomRange`

---

### Task 1: Add hover-aware paint builder + tests

**Skill:** `superpowers:test-driven-development`
**Flow position:** Step 1 of 5 in F04 (paint-builders → **hover-aware-paint** → DataLayerRenderer)
**Upstream contract:** `getLayerPaint(layer, paintType)` returns `Record<string, unknown>` base paint
**Downstream contract:** `getHoverAwarePaint(layer, paintType)` returns paint with feature-state hover expression; consumed by DataLayerRenderer sublayer `paint` props

**Codebooks:** `interactive-spatial-editing`

<contracts>
**Upstream (map-styles.ts getLayerPaint → getHoverAwarePaint):**
- `getLayerPaint(layer: Layer, paintType: PaintType): Record<string, unknown>`
- Invariant: always returns at least PAINT_DEFAULTS for the type; never empty

**Downstream (getHoverAwarePaint → DataLayerRenderer paint props):**
- `getHoverAwarePaint(layer: Layer, paintType: PaintType): Record<string, unknown>`
- Invariant: paint contains `feature-state` expression for opacity boost on hover
- Invariant: when no hover state set, renders identically to base paint
</contracts>

**Files:**
- Modify: `apps/web/src/lib/components/map/map-styles.ts`
- Create: `apps/web/src/__tests__/map-styles.test.ts`

- [ ] **Step 1: Write failing tests for existing paint builders**

Note: `apps/web/src/__tests__/map-styles.test.ts` already exists (with `makeLayer` helper, `nullConverter`, etc.). Add the new `getHoverAwarePaint` describe block to the **existing** file. Import `getHoverAwarePaint` in the existing import block.

```typescript
// Add to existing apps/web/src/__tests__/map-styles.test.ts imports:
// import { ..., getHoverAwarePaint } from '../lib/components/map/map-styles.js';

// Add this describe block at the end of the file:

describe('getHoverAwarePaint', () => {
  it('adds feature-state hover opacity boost for fill layers', () => {
    const layer = makeLayer({});
    const result = getHoverAwarePaint(layer, 'fill');
    const opacityExpr = result['fill-opacity'];
    expect(opacityExpr).toEqual([
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it('adds feature-state hover opacity boost for circle layers', () => {
    const layer = makeLayer({});
    const result = getHoverAwarePaint(layer, 'circle');
    const opacityExpr = result['circle-opacity'];
    expect(opacityExpr).toEqual([
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it('adds feature-state hover opacity boost for line layers', () => {
    const layer = makeLayer({});
    const result = getHoverAwarePaint(layer, 'line');
    const opacityExpr = result['line-opacity'];
    expect(opacityExpr).toEqual([
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      expect.any(Number),
      expect.any(Number),
    ]);
  });

  it('hover opacity is higher than base opacity', () => {
    const layer = makeLayer({});
    const result = getHoverAwarePaint(layer, 'fill');
    const [, , , hoverVal, baseVal] = result['fill-opacity'] as unknown[];
    expect(hoverVal).toBeGreaterThan(baseVal as number);
  });

  it('clamps hover opacity at 1.0 when base is already high', () => {
    const layer = makeLayer({ style: { paint: { 'fill-opacity': 0.95 } } });
    const result = getHoverAwarePaint(layer, 'fill');
    const [, , , hoverVal] = result['fill-opacity'] as unknown[];
    expect(hoverVal).toBeLessThanOrEqual(1.0);
  });

  it('preserves all other paint properties from base paint', () => {
    const layer = makeLayer({ style: { paint: { 'fill-color': '#ff0000' } } });
    const result = getHoverAwarePaint(layer, 'fill');
    expect(result['fill-color']).toBe('#ff0000');
  });

  it('handles null style gracefully', () => {
    const layer = makeLayer({ style: null });
    const result = getHoverAwarePaint(layer, 'fill');
    expect(result['fill-opacity']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/__tests__/map-styles.test.ts`
Expected: FAIL — `getHoverAwarePaint` is not exported from map-styles.ts

- [ ] **Step 3: Implement getHoverAwarePaint**

Add to `apps/web/src/lib/components/map/map-styles.ts`:

```typescript
/**
 * Opacity keys per paint type — used by hover-aware paint to add feature-state expressions.
 * Symbol layers are excluded: they render labels, not interactive data features.
 */
const OPACITY_KEYS: Record<PaintType, string> = {
  circle: 'circle-opacity',
  line: 'line-opacity',
  fill: 'fill-opacity',
};

/** Hover boost: how much to increase opacity when feature-state.hover is true. */
const HOVER_OPACITY_BOOST = 0.15;

/**
 * Build a paint object with feature-state-aware hover opacity.
 *
 * Wraps the opacity property in a MapLibre expression:
 *   ['case', ['boolean', ['feature-state', 'hover'], false], boostedOpacity, baseOpacity]
 *
 * When FeatureState sets {hover: true} on a feature, MapLibre evaluates
 * the expression and applies the boosted opacity — no paint rebuild needed.
 */
export function getHoverAwarePaint(layer: Layer, paintType: PaintType): Record<string, unknown> {
  const basePaint = getLayerPaint(layer, paintType);
  const opacityKey = OPACITY_KEYS[paintType];
  const baseOpacity = (basePaint[opacityKey] as number) ??
    (PAINT_DEFAULTS[paintType] as Record<string, unknown>)[opacityKey] as number ??
    0.85;
  const hoverOpacity = Math.min(1, baseOpacity + HOVER_OPACITY_BOOST);

  return {
    ...basePaint,
    [opacityKey]: [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      hoverOpacity,
      baseOpacity,
    ],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && pnpm vitest run src/__tests__/map-styles.test.ts`
Expected: PASS — all tests green

- [ ] **Step 5: Run full test suite to verify no regressions**

Run: `cd apps/web && pnpm test`
Expected: All existing tests pass

- [ ] **Step 6: Run type check**

Run: `cd apps/web && pnpm check`
Expected: No new type errors

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/components/map/map-styles.ts apps/web/src/__tests__/map-styles.test.ts
git commit -m "feat: add hover-aware paint builder with feature-state expressions"
```

---

### Task 2: Extract DataLayerRenderer component

**Skill:** `superpowers:test-driven-development`
**Flow position:** Step 2 of 5 in F03 (layerRenderCache → **DataLayerRenderer** → rendered map layers)
**Upstream contract:** Receives layer render cache, layer data, and interaction callbacks from MapCanvas
**Downstream contract:** Renders GeoJSON/VT sources with sublayers; forwards click/hover events to parent

**Codebooks:** `interactive-spatial-editing`

<contracts>
**Upstream (MapCanvas → DataLayerRenderer):**
- `layers: Layer[]` — visible layers from layersStore.all
- `layerData: Record<string, FeatureCollection>` — GeoJSON per layer
- `layerRenderCache: Record<string, LayerRenderCache>` — memoized paint/filter
- `firstLabelLayerId: string | undefined` — for beforeId z-ordering
- `onfeatureclick: (feature, event, layerStyle?, layerId?) => void`
- `onfeaturehover: (feature, event, layerId?) => void`
- `onfeatureleave: () => void`
- Invariant: layerRenderCache has an entry for every visible layer

**Downstream (DataLayerRenderer → map):**
- Renders VectorTileSource or GeoJSONSource per layer with Fill+Line+Circle+Symbol sublayers
- Renders hot overlay for VT layers
- Calls onfeatureclick/onfeaturehover/onfeatureleave on user interaction
- Invariant: only ONE sublayer per source fires onclick for a given click (deduplicated)
</contracts>

**Files:**
- Create: `apps/web/src/lib/components/map/DataLayerRenderer.svelte`

- [ ] **Step 1: Write DataLayerRenderer component**

Create `apps/web/src/lib/components/map/DataLayerRenderer.svelte`:

```svelte
<script lang="ts">
  import { GeoJSONSource, VectorTileSource, FillLayer, LineLayer, CircleLayer, SymbolLayer } from 'svelte-maplibre-gl';
  import type { FillLayerSpecification, LineLayerSpecification, CircleLayerSpecification } from 'maplibre-gl';
  import type { Layer, GeoJSONFeature, LayerStyle } from '@felt-like-it/shared-types';
  import type { MapMouseEvent } from 'maplibre-gl';
  import { hotOverlay } from '$lib/utils/map-sources.svelte.js';
  import { PUBLIC_MARTIN_URL } from '$env/static/public';
  import { VECTOR_TILE_THRESHOLD } from '$lib/utils/constants.js';

  // TYPE_DEBT: symbolPaint/symbolLayout use any because MapLibre spec types are
  // strict discriminated unions that our dynamic builders can't satisfy statically.
  // Runtime-safe — MapLibre validates before rendering.
  interface LayerRenderCache {
    fillPaint: Record<string, unknown>;
    linePaint: Record<string, unknown>;
    circlePaint: Record<string, unknown>;
    symbolPaint: any; // TYPE_DEBT: SymbolLayerSpecification['paint'] union
    symbolLayout: any; // TYPE_DEBT: SymbolLayerSpecification['layout'] union
    filter: unknown[] | undefined;
    vtFilter: unknown[];
    labelAttr: string | undefined;
    clickable: boolean;
    sandwiched: boolean;
    isHeatmap: boolean;
    usesVT: boolean;
    layerStyle: LayerStyle | null | undefined;
  }

  interface Props {
    layers: Layer[];
    layerData: Record<string, { type: 'FeatureCollection'; features: GeoJSONFeature[] }>;
    layerRenderCache: Record<string, LayerRenderCache>;
    firstLabelLayerId?: string | undefined;
    annotatedByLayer?: Map<string, string[]> | undefined;
    onfeatureclick?: ((feature: GeoJSONFeature, event: MapMouseEvent, layerStyle?: LayerStyle, layerId?: string) => void) | undefined;
    onfeaturehover?: ((feature: GeoJSONFeature, event: MapMouseEvent, layerId?: string) => void) | undefined;
    onfeatureleave?: (() => void) | undefined;
  }

  let {
    layers,
    layerData,
    layerRenderCache,
    firstLabelLayerId,
    annotatedByLayer,
    onfeatureclick,
    onfeaturehover,
    onfeatureleave,
  }: Props = $props();

  const MARTIN_SOURCE_LAYER = 'public.features';
  const EMPTY_COLLECTION: { type: 'FeatureCollection'; features: GeoJSONFeature[] } = { type: 'FeatureCollection', features: [] };
  const ANNOTATION_HIGHLIGHT_PAINT = { 'line-color': '#f59e0b', 'line-width': 3, 'line-opacity': 0.6 };

  function martinTileUrl(): string {
    return `${PUBLIC_MARTIN_URL}/public.features/{z}/{x}/{y}`;
  }

  /** Unified click handler — replaces 6 duplicated inline handlers. */
  function handleClick(e: any, lrc: LayerRenderCache, layerId: string) {
    if (!lrc.clickable) return;
    const f = e.features?.[0];
    if (f) onfeatureclick?.(f as unknown as GeoJSONFeature, e, lrc.layerStyle ?? undefined, layerId);
  }

  /** Unified hover handler — adds cursor feedback + forwards to parent. */
  function handleMouseEnter(e: any, layerId: string) {
    const canvas = e.target?.getCanvas?.();
    if (canvas) canvas.style.cursor = 'pointer';
    const f = e.features?.[0];
    if (f) onfeaturehover?.(f as unknown as GeoJSONFeature, e, layerId);
  }

  function handleMouseLeave(e: any) {
    const canvas = e.target?.getCanvas?.();
    if (canvas) canvas.style.cursor = '';
    onfeatureleave?.();
  }
</script>

{#each layers as layer (layer.id)}
  {#if layer.visible}
    {@const lrc = layerRenderCache[layer.id]}
    {@const data = layerData[layer.id] ?? EMPTY_COLLECTION}

    {#if lrc && !lrc.isHeatmap && lrc.usesVT}
      <VectorTileSource id={`source-${layer.id}`} tiles={[martinTileUrl()]}>
        <FillLayer
          id={`layer-${layer.id}-fill`}
          sourceLayer={MARTIN_SOURCE_LAYER}
          paint={lrc.fillPaint as unknown as NonNullable<FillLayerSpecification['paint']>}
          filter={lrc.vtFilter as unknown as NonNullable<FillLayerSpecification['filter']>}
          {...(lrc.sandwiched && firstLabelLayerId ? { beforeId: firstLabelLayerId } : {})}
          onclick={(e) => handleClick(e, lrc, layer.id)}
          onmouseenter={(e) => handleMouseEnter(e, layer.id)}
          onmouseleave={handleMouseLeave}
        />
        <LineLayer
          id={`layer-${layer.id}-line`}
          sourceLayer={MARTIN_SOURCE_LAYER}
          paint={lrc.linePaint as unknown as NonNullable<LineLayerSpecification['paint']>}
          filter={lrc.vtFilter as unknown as NonNullable<LineLayerSpecification['filter']>}
          onclick={(e) => handleClick(e, lrc, layer.id)}
          onmouseenter={(e) => handleMouseEnter(e, layer.id)}
          onmouseleave={handleMouseLeave}
        />
        <CircleLayer
          id={`layer-${layer.id}-circle`}
          sourceLayer={MARTIN_SOURCE_LAYER}
          paint={lrc.circlePaint as unknown as NonNullable<CircleLayerSpecification['paint']>}
          filter={lrc.vtFilter as unknown as NonNullable<CircleLayerSpecification['filter']>}
          onclick={(e) => handleClick(e, lrc, layer.id)}
          onmouseenter={(e) => handleMouseEnter(e, layer.id)}
          onmouseleave={handleMouseLeave}
        />
        {#if lrc.labelAttr && lrc.symbolLayout && lrc.symbolPaint}
          <SymbolLayer
            id={`layer-${layer.id}-label`}
            sourceLayer={MARTIN_SOURCE_LAYER}
            layout={lrc.symbolLayout}
            paint={lrc.symbolPaint}
          />
        {/if}
      </VectorTileSource>
    {:else if lrc && !lrc.isHeatmap}
      <GeoJSONSource id={`source-${layer.id}`} data={data} promoteId="id">
        <FillLayer
          id={`layer-${layer.id}-fill`}
          paint={lrc.fillPaint as unknown as NonNullable<FillLayerSpecification['paint']>}
          filter={lrc.filter as unknown as NonNullable<FillLayerSpecification['filter']>}
          {...(lrc.sandwiched && firstLabelLayerId ? { beforeId: firstLabelLayerId } : {})}
          onclick={(e) => handleClick(e, lrc, layer.id)}
          onmouseenter={(e) => handleMouseEnter(e, layer.id)}
          onmouseleave={handleMouseLeave}
        />
        <LineLayer
          id={`layer-${layer.id}-line`}
          paint={lrc.linePaint as unknown as NonNullable<LineLayerSpecification['paint']>}
          filter={lrc.filter as unknown as NonNullable<LineLayerSpecification['filter']>}
          onclick={(e) => handleClick(e, lrc, layer.id)}
          onmouseenter={(e) => handleMouseEnter(e, layer.id)}
          onmouseleave={handleMouseLeave}
        />
        <CircleLayer
          id={`layer-${layer.id}-circle`}
          paint={lrc.circlePaint as unknown as NonNullable<CircleLayerSpecification['paint']>}
          filter={lrc.filter as unknown as NonNullable<CircleLayerSpecification['filter']>}
          onclick={(e) => handleClick(e, lrc, layer.id)}
          onmouseenter={(e) => handleMouseEnter(e, layer.id)}
          onmouseleave={handleMouseLeave}
        />
        {#if lrc.labelAttr && lrc.symbolLayout && lrc.symbolPaint}
          <SymbolLayer
            id={`layer-${layer.id}-label`}
            layout={lrc.symbolLayout}
            paint={lrc.symbolPaint}
          />
        {/if}
        {@const highlightIds = annotatedByLayer?.get(layer.id)}
        {#if highlightIds?.length}
          <LineLayer
            id={`layer-${layer.id}-annotation-highlight`}
            paint={ANNOTATION_HIGHLIGHT_PAINT}
            filter={['in', ['to-string', ['id']], ['literal', highlightIds]]}
          />
        {/if}
      </GeoJSONSource>
    {/if}
  {/if}
{/each}

<!-- Hot overlay for VT layers -->
{#each layers as layer (layer.id)}
  {@const hotLrc = layerRenderCache[layer.id]}
  {#if layer.visible && hotLrc?.usesVT}
    {@const hotCollection = hotOverlay.getCollection(layer.id)}
    {#if hotCollection.features.length > 0}
      <GeoJSONSource id={`hot-overlay-${layer.id}`} data={hotCollection as unknown as { type: 'FeatureCollection'; features: GeoJSONFeature[] }} promoteId="id">
        <FillLayer id={`hot-overlay-${layer.id}-fill`} paint={hotLrc.fillPaint as unknown as NonNullable<FillLayerSpecification['paint']>} />
        <LineLayer id={`hot-overlay-${layer.id}-line`} paint={hotLrc.linePaint as unknown as NonNullable<LineLayerSpecification['paint']>} />
        <CircleLayer id={`hot-overlay-${layer.id}-circle`} paint={hotLrc.circlePaint as unknown as NonNullable<CircleLayerSpecification['paint']>} />
      </GeoJSONSource>
    {/if}
  {/if}
{/each}
```

**Key changes from original:**
- 6 duplicated onclick handlers → 1 `handleClick` function
- Added `onmouseenter`/`onmouseleave` on all data sublayers (NEW — enables F04 hover)
- Cursor change handled inside component (was missing on data layers)
- Hot overlay included (was in MapCanvas L598-619)

- [ ] **Step 2: Verify component compiles**

Run: `cd apps/web && pnpm check`
Expected: No type errors in DataLayerRenderer.svelte

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/map/DataLayerRenderer.svelte
git commit -m "feat(F03): extract DataLayerRenderer from MapCanvas — unified event handlers"
```

---

### Task 3: Extract AnnotationRenderer component

**Skill:** `superpowers:test-driven-development`
**Flow position:** Step 3 of 5 in F03 (annotation data → **AnnotationRenderer** → rendered annotations)
**Upstream contract:** Receives annotation GeoJSON collections and interaction callbacks from MapCanvas
**Downstream contract:** Renders annotation pins, regions, badges, measurements + popups

<contracts>
**Upstream (MapCanvas → AnnotationRenderer):**
- `annotationPins?: AnnotationPinCollection` — pin features with embedded content JSON
- `annotationRegions?: AnnotationRegionCollection` — region polygon features
- `badgeGeoJson: FeatureCollection<Point>` — badge indicator centroids
- `measurementAnnotations?: FeatureCollection` — measurement geometries
- `onbadgeclick?: (featureId: string) => void`
- Invariant: all GeoJSON is valid; content JSON is parseable via AnnotationObjectContentSchema

**Downstream (AnnotationRenderer → map):**
- Renders GeoJSONSource + layer components for each annotation type
- Manages own selectedAnnotation/hoveredAnnotation state
- Renders annotation Popups (hover tooltip + click popup)
- Invariant: annotation popups are independent of editorState feature popups
</contracts>

**Files:**
- Create: `apps/web/src/lib/components/map/AnnotationRenderer.svelte`

- [ ] **Step 1: Write AnnotationRenderer component**

Create `apps/web/src/lib/components/map/AnnotationRenderer.svelte`.

This component extracts MapCanvas lines 632-873. It contains:
- Annotation pin GeoJSONSource + CircleLayer with hover+click (L632-705)
- Annotation region GeoJSONSource + FillLayer+LineLayer with hover+click (L707-783)
- Badge GeoJSONSource + CircleLayer+SymbolLayer (L786-808)
- Measurement GeoJSONSource + Line+Fill+Symbol layers (L810-840)
- Hover tooltip Popup (L842-857)
- Selected annotation Popup (L859-873)
- All annotation-related state: `selectedAnnotation`, `hoveredAnnotation`
- All annotation-related constants: `ANNOTATION_PIN_PAINT`, `ANNOTATION_REGION_*_PAINT`, `BADGE_*`, `MEASURE_*`

The component receives the same props MapCanvas passes to these sections. The `editorState` is accessed via `getMapEditorState()` context for the drawing-tool guard on clicks. The `_lastClickTs`/`CLICK_DEDUP_MS` dedup guard is included for mobile tap deduplication.

**Interface:**
```typescript
interface Props {
  annotationPins?: AnnotationPinCollection | undefined;
  annotationRegions?: AnnotationRegionCollection | undefined;
  badgeGeoJson: { type: 'FeatureCollection'; features: Feature<Point>[] };
  measurementAnnotations?: { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }[] } | undefined;
  onbadgeclick?: ((featureId: string) => void) | undefined;
}
```

Implementation: move MapCanvas L266-288 (paint constants), L401-468 (annotation state + badge computation stays in MapCanvas as `badgeGeoJson` $derived, passed as prop), L632-873 (template) into this component. Import `AnnotationObjectContentSchema`, `AnnotationContent`, `getMapEditorState`, etc.

- [ ] **Step 2: Verify component compiles**

Run: `cd apps/web && pnpm check`
Expected: No type errors in AnnotationRenderer.svelte

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/components/map/AnnotationRenderer.svelte
git commit -m "feat(F03): extract AnnotationRenderer from MapCanvas — pins, regions, badges, measurements"
```

---

### Task 4: Wire components + add FeatureState hover highlighting

**Skill:** `superpowers:test-driven-development`
**Flow position:** Step 4 of 5 — F03 integration + F04 hover (MapCanvas orchestrator → **DataLayerRenderer+AnnotationRenderer+FeatureState** → interactive map)
**Upstream contract:** MapCanvas props unchanged; child components provide event callbacks
**Downstream contract:** User sees cursor change + opacity highlight on hover; existing click/popup behavior preserved

**Codebooks:** `interactive-spatial-editing`, `optimistic-ui-vs-data-consistency`

<contracts>
**Upstream (DataLayerRenderer → MapCanvas hover callback):**
- `onfeaturehover(feature: GeoJSONFeature, event: MapMouseEvent, layerId?: string)` — feature has `.id` and `.source`
- `onfeatureleave()` — hover ended
- Invariant: only one feature hovered at a time

**Downstream (MapCanvas → FeatureState component):**
- `<FeatureState id={hoveredFeature.id} source={sourceId} state={{hover: true}} />`
- Invariant: FeatureState unmounts when hoveredFeature becomes null (cleanup automatic)
</contracts>

**Files:**
- Modify: `apps/web/src/lib/components/map/MapCanvas.svelte` (major rewrite — slim to orchestrator)

- [ ] **Step 1: Import child components and FeatureState**

Add imports to MapCanvas.svelte:
```typescript
import { FeatureState } from 'svelte-maplibre-gl';
import DataLayerRenderer from './DataLayerRenderer.svelte';
import AnnotationRenderer from './AnnotationRenderer.svelte';
```

- [ ] **Step 2: Add hoveredFeature state**

Add to MapCanvas script section (after `mapInstance` declaration):
```typescript
/** Currently hovered data feature — drives FeatureState highlight. */
let hoveredFeature = $state<{ id: string | number; source: string; layerId: string } | null>(null);
```

- [ ] **Step 3: Replace data layer template with DataLayerRenderer**

Replace MapCanvas lines 483-619 (the entire `{#each layersStore.all}` data layer loop + hot overlay loop) with:

```svelte
<DataLayerRenderer
  layers={layersStore.all}
  {layerData}
  {layerRenderCache}
  {firstLabelLayerId}
  {annotatedByLayer}
  onfeatureclick={handleFeatureClick}
  onfeaturehover={(feature, _event, layerId) => {
    hoveredFeature = feature.id != null
      ? { id: feature.id, source: `source-${layerId}`, layerId: layerId ?? '' }
      : null;
  }}
  onfeatureleave={() => { hoveredFeature = null; }}
/>
```

- [ ] **Step 4: Replace annotation template with AnnotationRenderer**

Replace MapCanvas lines 632-873 (annotation pins through annotation popups) with:

```svelte
<AnnotationRenderer
  {annotationPins}
  {annotationRegions}
  {badgeGeoJson}
  {measurementAnnotations}
  {onbadgeclick}
/>
```

- [ ] **Step 5: Add FeatureState for hover highlight**

Add before the feature popup Popup (currently L621), inside the MapLibre component:

```svelte
<!-- Feature hover highlight via FeatureState -->
{#if hoveredFeature}
  <FeatureState
    id={hoveredFeature.id}
    source={hoveredFeature.source}
    state={{ hover: true }}
  />
{/if}
```

- [ ] **Step 6: Remove extracted code from MapCanvas**

Remove from MapCanvas script section:
- Annotation paint constants (L266-288) — moved to AnnotationRenderer
- `selectedAnnotation` and `hoveredAnnotation` state (L407-418) — moved to AnnotationRenderer
- `EMPTY_COLLECTION` constant — moved to DataLayerRenderer
- `usesVectorTiles()`, `martinTileUrl()`, `getVectorTileFilter()` functions — moved to DataLayerRenderer
- `MARTIN_SOURCE_LAYER` constant — moved to DataLayerRenderer

Keep in MapCanvas:
- All imports needed for remaining functionality
- `mapInstance`, viewport sync effects, `firstLabelLayerId` effect
- `layerRenderCache` $derived.by (drives DataLayerRenderer)
- `heatmapLayerDefs` $derived (drives DeckGLOverlay)
- `annotatedByLayer` and `badgeGeoJson` $derived (drives AnnotationRenderer)
- `handleFeatureClick` function (uses editorState)
- `selectedLayerStyle` state
- Feature popup template section
- DeckGLOverlay and DrawingToolbar

- [ ] **Step 7: Update layerRenderCache to use hover-aware paint**

In the `layerRenderCache` $derived.by, replace the `getLayerPaint` wrapper (MapCanvas L342-348) with direct calls to `getHoverAwarePaint` + `applyHighlight`:

```typescript
import { getHoverAwarePaint } from './map-styles.js';

// Remove the getLayerPaint wrapper function (L342-348) — no longer needed.
// Inside layerRenderCache computation, replace the paint lines:
result[layer.id] = {
  fillPaint: applyHighlight(getHoverAwarePaint(layer, 'fill'), 'fill', highlightColor, selectedFeature?.id),
  linePaint: applyHighlight(getHoverAwarePaint(layer, 'line'), 'line', highlightColor, selectedFeature?.id),
  circlePaint: applyHighlight(getHoverAwarePaint(layer, 'circle'), 'circle', highlightColor, selectedFeature?.id),
  // ... rest unchanged
};
```

The chain is: `getHoverAwarePaint` (base + feature-state hover expression) → `applyHighlight` (adds selection case expression on top). Two layers of conditional paint — hover via feature-state, selection via ID match.

- [ ] **Step 8: Run type check**

Run: `cd apps/web && pnpm check`
Expected: No type errors

- [ ] **Step 9: Run full test suite**

Run: `cd apps/web && pnpm test`
Expected: All existing tests pass (interaction-modes, map-editor-state, drawing-save, etc.)

- [ ] **Step 10: Verify MapCanvas line count reduction**

Run: `wc -l apps/web/src/lib/components/map/MapCanvas.svelte`
Expected: ~250 lines (down from 887)

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/lib/components/map/MapCanvas.svelte apps/web/src/lib/components/map/DataLayerRenderer.svelte apps/web/src/lib/components/map/AnnotationRenderer.svelte
git commit -m "feat(F03+F04): slim MapCanvas to orchestrator, add hover highlight via FeatureState"
```

---

### Task 5: Verification and cleanup

**Skill:** `none`
**Flow position:** Step 5 of 5 — cross-cutting verification

**Files:**
- Verify: all modified files

- [ ] **Step 1: Run full project build**

Run: `pnpm build`
Expected: Build succeeds (verifies all imports, $env, types resolve)

- [ ] **Step 2: Run full lint**

Run: `pnpm lint`
Expected: No lint errors in new/modified files

- [ ] **Step 3: Run full test suite from project root**

Run: `pnpm test`
Expected: All tests pass across all packages

- [ ] **Step 4: Verify no import cycles**

Run: `grep -r "import.*MapCanvas" apps/web/src/lib/components/map/DataLayerRenderer.svelte apps/web/src/lib/components/map/AnnotationRenderer.svelte`
Expected: No results (children don't import parent)

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git add -u
git commit -m "chore: wave 1 cleanup — lint fixes and import tidying"
```

---

## Execution Waves

**Wave 0: Task 1** (paint builder + tests) — no dependencies
**Wave 1: Tasks 2, 3** (parallel) — extract DataLayerRenderer + AnnotationRenderer; depend on Wave 0
**Wave 2: Task 4** — wire components + FeatureState hover; depends on Wave 1
**Wave 3: Task 5** — verification; depends on Wave 2

## Open Questions

### Wave 0
- **Task 1: hover paint builder**
  - Q: Does `feature-state` work with GeoJSON sources where features use string UUIDs as IDs? MapLibre requires numeric IDs or `promoteId`. **Mitigated**: Plan adds `promoteId="id"` on all GeoJSONSource components. Verify during implementation that features actually have a top-level `id` property. (Tier: Blocking — verify with actual layer data)
  - Q: Should hover boost opacity or change color? Opacity is subtler; color is more visible. (Tier: Exploratory — try opacity first, adjust if insufficient)

### Wave 1
- **Task 2: DataLayerRenderer**
  - Q: Do svelte-maplibre-gl layer events provide `e.target.getCanvas()` for cursor control? Need to verify event object shape. (Tier: Blocking — read the event type or test empirically)
  - Q: Does extracting the layer loop into a child component break the `{@const lrc = layerRenderCache[layer.id]}` pattern? Svelte 5 should handle this since it's a template-level binding. (Tier: Exploratory — `pnpm check` will catch it)
- **Task 3: AnnotationRenderer**
  - (none — fully specified; direct extraction of existing working code)

### Wave 2
- **Task 4: integration**
  - Q: When DataLayerRenderer calls `onfeaturehover`, does `feature.id` match the ID format expected by `FeatureState`? If features use string UUIDs, `FeatureState` may need `source` + the promoted ID property name. (Tier: Blocking — same as Wave 0 Q1; answer carries forward)
  - Q: Does the `layerRenderCache` recompute when `getHoverAwarePaint` is swapped in? The $derived.by tracks the same dependencies. (Tier: Exploratory — verified by `pnpm check` + visual test)

### Flow Contracts
- Q: Does DataLayerRenderer's `handleMouseLeave` need to verify the mouse actually left the feature (vs. moved to another feature in the same layer)? MapLibre's `onmouseleave` on layers fires per-layer, not per-feature. (Tier: Exploratory — test with overlapping features)
- Q: Can AnnotationRenderer's `queueMicrotask` pattern cause stale closures if the user clicks rapidly? The current code captures `parsed` and `props` in the closure. (Tier: Exploratory — inherited from existing code, not a new risk)

## Key Assumptions

1. **Features have IDs**: GeoJSON features in `layerData` have top-level `id` fields (used by existing `applyHighlight` with `['==', ['id'], selectedFeatureId]`)
2. **FeatureState works with GeoJSON sources**: svelte-maplibre-gl's FeatureState component calls `map.setFeatureState({source, id}, state)` — requires `promoteId="id"` on GeoJSONSource for string-ID features (added in DataLayerRenderer)
3. **Layer events provide feature data**: svelte-maplibre-gl layer `onmouseenter` callbacks receive `e.features` (confirmed by reading CircleLayer → RawLayer delegation)
4. **Child components share MapLibre context**: Components rendered inside `<MapLibre>` can access sources/layers via Svelte context (confirmed by context system investigation)
5. **Render cache memoization prevents infinite loops**: Extracting to child components doesn't change when $derived.by recomputes — same tracked dependencies

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `apps/web/src/lib/components/map/map-styles.ts` | patch | `export function getHoverAwarePaint` |
| `apps/web/src/__tests__/map-styles.test.ts` | patch | `describe('getHoverAwarePaint'` |
| `apps/web/src/lib/components/map/DataLayerRenderer.svelte` | create | `function handleClick(e: any, lrc: LayerRenderCache` |
| `apps/web/src/lib/components/map/AnnotationRenderer.svelte` | create | `let selectedAnnotation = $state` |
| `apps/web/src/lib/components/map/MapCanvas.svelte` | patch | `import DataLayerRenderer from './DataLayerRenderer.svelte'` |
| `apps/web/src/lib/components/map/MapCanvas.svelte` | patch | `let hoveredFeature = $state` |
| `apps/web/src/lib/components/map/MapCanvas.svelte` | patch | `<FeatureState` |
<!-- PLAN_MANIFEST_END -->
