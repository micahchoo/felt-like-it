<script lang="ts">
  import { GeoJSONSource, VectorTileSource, FillLayer, LineLayer, CircleLayer, SymbolLayer } from 'svelte-maplibre-gl';
  import type { FillLayerSpecification, LineLayerSpecification, CircleLayerSpecification } from 'maplibre-gl';
  import type { Layer, GeoJSONFeature, LayerStyle } from '@felt-like-it/shared-types';
  import type { MapMouseEvent, MapLayerMouseEvent } from 'maplibre-gl';
  import { getHotOverlayStore } from '$lib/utils/map-sources.svelte.js';
  const hotOverlay = getHotOverlayStore();
  import { PUBLIC_MARTIN_URL } from '$env/static/public';

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
    onfeatureclick?: ((_feature: GeoJSONFeature, _event: MapMouseEvent, _layerStyle?: LayerStyle, _layerId?: string) => void) | undefined;
    onfeaturehover?: ((_feature: GeoJSONFeature, _event: MapMouseEvent, _layerId?: string) => void) | undefined;
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

  // svelte-maplibre-gl layer components emit MapLayerMouseEvent — which carries
  // MapLibre's MapGeoJSONFeature in `features`. We forward a narrower
  // GeoJSONFeature shape to parent callbacks via a boundary cast.
  type LayerMouseEvent = MapLayerMouseEvent;

  /** Unified click handler — replaces 6 duplicated inline handlers. */
  function handleClick(e: LayerMouseEvent, lrc: LayerRenderCache, layerId: string) {
    if (!lrc.clickable) return;
    const f = e.features?.[0] as unknown as GeoJSONFeature | undefined;
    if (f) onfeatureclick?.(f, e, lrc.layerStyle ?? undefined, layerId);
  }

  /** Unified hover handler — adds cursor feedback + forwards to parent. */
  function handleMouseEnter(e: LayerMouseEvent, layerId: string) {
    const canvas = e.target?.getCanvas?.();
    if (canvas) canvas.style.cursor = 'pointer';
    const f = e.features?.[0] as unknown as GeoJSONFeature | undefined;
    if (f) onfeaturehover?.(f, e, layerId);
  }

  function handleMouseLeave(e: LayerMouseEvent) {
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
