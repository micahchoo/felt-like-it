<script lang="ts">
  import { MapLibre, GeoJSONSource, VectorTileSource, CircleLayer, LineLayer, FillLayer, SymbolLayer, Popup } from 'svelte-maplibre-gl';
  import type { Map as MapLibreMap, MapMouseEvent, FillLayerSpecification, LineLayerSpecification, CircleLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
  import { PUBLIC_MARTIN_URL } from '$env/static/public';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { selectionStore } from '$lib/stores/selection.svelte.js';
  import type { Layer, GeoJSONFeature } from '@felt-like-it/shared-types';
  import { fslFiltersToMapLibre, resolvePaintInterpolators } from '@felt-like-it/geo-engine';
  import type { MeasurementResult } from '@felt-like-it/geo-engine';
  import { filterStore } from '$lib/stores/filters.svelte.js';
  import DrawingToolbar from './DrawingToolbar.svelte';
  import FeaturePopup from './FeaturePopup.svelte';
  import AnnotationContent from '$lib/components/annotations/AnnotationContent.svelte';
  import DeckGLOverlay from './DeckGLOverlay.svelte';
  import { AnnotationContentSchema } from '@felt-like-it/shared-types';
  import type { AnnotationContent as AnnotationContentType } from '@felt-like-it/shared-types';
  import type { HeatmapLayerDef } from './DeckGLOverlay.svelte';
  import type { LayerStyle } from '@felt-like-it/shared-types';

  /**
   * GeoJSON representation of annotation pins passed in from MapEditor.
   * Each feature's `properties` embeds the content as a JSON string so the
   * popup can render it without a separate data fetch.
   */
  interface AnnotationPinProperties {
    authorName: string;
    createdAt: string;
    /** JSON.stringify(AnnotationContent) — parsed on click. */
    contentJson: string;
  }

  interface AnnotationPin {
    type: 'Feature';
    /** Annotation UUID — used as the MapLibre feature id for click identification. */
    id: string;
    geometry: { type: 'Point'; coordinates: [number, number] };
    properties: AnnotationPinProperties;
  }

  export interface AnnotationPinCollection {
    type: 'FeatureCollection';
    features: AnnotationPin[];
  }

  interface Props {
    readonly?: boolean;
    /** GeoJSON data per layer id */
    layerData: Record<string, { type: 'FeatureCollection'; features: GeoJSONFeature[] }>;
    onfeaturedrawn?: (_layerId: string, _feature: Record<string, unknown>) => void;
    /**
     * Annotation pins rendered as a dedicated amber circle layer.
     * Omit (or pass undefined) to hide annotation pins — used in the share viewer.
     */
    annotationPins?: AnnotationPinCollection;
    /**
     * When provided, the drawing toolbar enters measurement mode: drawn features
     * are NOT saved to any layer — instead the computed MeasurementResult is passed here.
     */
    onmeasured?: (_result: MeasurementResult) => void;
  }

  let { readonly = false, layerData, onfeaturedrawn, annotationPins, onmeasured }: Props = $props();

  let mapInstance = $state<MapLibreMap | undefined>(undefined);

  // Sync map instance to global store
  $effect(() => {
    mapStore.setMapInstance(mapInstance);
  });

  /**
   * ID of the first basemap symbol layer (e.g. road labels, city names).
   * Computed once the map is loaded; used by isSandwiched to position FillLayers
   * beneath basemap text so polygon fills don't obscure map labels.
   */
  let firstLabelLayerId = $state<string | undefined>(undefined);
  $effect(() => {
    if (!mapInstance) { firstLabelLayerId = undefined; return; }
    firstLabelLayerId = mapInstance.getStyle()?.layers.find((l) => l.type === 'symbol')?.id;
  });

  /**
   * Layers that should be rendered by deck.gl instead of MapLibre.
   * Currently only style.type === 'heatmap' (point-only kernel density).
   * Non-Point features in a heatmap layer are silently filtered out —
   * HeatmapLayer requires [lng, lat] coordinates.
   */
  const heatmapLayerDefs = $derived(
    layersStore.all
      .filter((l) => l.visible && (l.style as Record<string, unknown>)?.['type'] === 'heatmap')
      .map<HeatmapLayerDef>((l) => {
        const config = ((l.style as Record<string, unknown>)?.['config'] as Record<string, unknown>) ?? {};
        const allFeatures = layerData[l.id]?.features ?? [];
        const pointFeatures = allFeatures.filter(
          (f): f is { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] }; properties: Record<string, unknown> | null } =>
            f.geometry?.type === 'Point' && Array.isArray(f.geometry.coordinates)
        );
        const weightAttr = config['heatmapWeightAttribute'] as string | undefined;
        return {
          id: l.id,
          features: pointFeatures,
          radiusPixels: (config['heatmapRadius'] as number | undefined) ?? 30,
          intensity: (config['heatmapIntensity'] as number | undefined) ?? 1,
          // exactOptionalPropertyTypes: only include weightAttribute key when defined
          ...(weightAttr !== undefined ? { weightAttribute: weightAttr } : {}),
        };
      })
  );

  /**
   * Feature count threshold above which a layer switches from GeoJSON source to
   * Martin vector tiles. 10K is a safe browser limit for smooth GeoJSON rendering.
   * Requires PUBLIC_MARTIN_URL to be set (non-empty string).
   */
  const VECTOR_TILE_THRESHOLD = 10_000;

  /** Martin tile source layer name — Martin uses `{schema}.{table}` by default. */
  const MARTIN_SOURCE_LAYER = 'public.features';

  /**
   * Whether this layer should be rendered via Martin vector tiles.
   * True when: featureCount > threshold AND Martin URL is configured.
   */
  function usesVectorTiles(layer: Layer): boolean {
    return (
      PUBLIC_MARTIN_URL.length > 0 &&
      (layer.featureCount ?? 0) > VECTOR_TILE_THRESHOLD
    );
  }

  /**
   * Build the Martin tile URL for a layer (browser-side URL).
   * Pattern: {MARTIN_URL}/public.features/{z}/{x}/{y}
   */
  function martinTileUrl(): string {
    return `${PUBLIC_MARTIN_URL}/public.features/{z}/{x}/{y}`;
  }

  /**
   * Combined MapLibre filter for a vector tile layer.
   * Adds layer_id equality check on top of any user-defined filters.
   */
  function getVectorTileFilter(layer: Layer): unknown[] {
    const baseFilter = getLayerFilter(layer);
    const layerIdFilter: unknown[] = ['==', ['get', 'layer_id'], layer.id];
    if (!baseFilter) return layerIdFilter;
    return ['all', layerIdFilter, baseFilter];
  }

  // MapLibre 5 crashes if paint: {} is passed — must always supply at least one explicit property.
  const PAINT_DEFAULTS: Record<'circle' | 'line' | 'fill', Record<string, unknown>> = {
    circle: { 'circle-radius': 6, 'circle-color': '#3b82f6', 'circle-opacity': 0.85, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff' },
    line:   { 'line-color': '#6366f1', 'line-width': 2, 'line-opacity': 0.9 },
    fill:   { 'fill-color': '#22c55e', 'fill-opacity': 0.45, 'fill-outline-color': '#15803d' },
  };

  function getLayerPaint(layer: Layer, paintType: 'circle' | 'line' | 'fill') {
    const style = layer.style as Record<string, unknown> | null | undefined;
    const rawPaint = (style?.['paint'] as Record<string, unknown>) ?? {};

    // Resolve FSL zoom interpolators (e.g. { linear: [[10,2],[16,8]] }) → MapLibre expressions
    const paint = resolvePaintInterpolators(rawPaint);

    // Only return paint properties relevant to this layer type
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(paint)) {
      if (key.startsWith(paintType + '-')) {
        filtered[key] = value;
      }
    }
    // Build a fresh result — never mutate PAINT_DEFAULTS (shared constant)
    const result: Record<string, unknown> =
      Object.keys(filtered).length > 0
        ? filtered
        : { ...(PAINT_DEFAULTS[paintType] as Record<string, unknown>) };

    // FSL highlightColor: when a feature is selected, wrap the primary color paint property
    // in a MapLibre 'case' expression so the selected feature renders in highlightColor.
    // Uses ['id'] (top-level GeoJSON feature id — UUID string) for the equality check;
    // no setFeatureState needed since features already carry their UUID at the top level.
    const highlightColor = style?.['highlightColor'] as string | undefined;
    const selectedFeature = selectionStore.selectedFeature;
    if (highlightColor !== undefined && selectedFeature !== null && selectedFeature.id !== undefined) {
      const colorKey = `${paintType}-color`;
      const baseColor = result[colorKey] ?? (PAINT_DEFAULTS[paintType] as Record<string, unknown>)[colorKey];
      result[colorKey] = ['case', ['==', ['id'], selectedFeature.id], highlightColor, baseColor];
    }

    return result;
  }

  /** Extract FSL-compatible label config from a layer's style jsonb. */
  function getLabelAttribute(layer: Layer): string | undefined {
    const style = layer.style as Record<string, unknown> | null | undefined;
    const config = style?.['config'] as Record<string, unknown> | undefined;
    return config?.['labelAttribute'] as string | undefined;
  }

  /**
   * FSL isClickable: when false, suppress all click interactions for this layer.
   * Defaults to true (undefined → clickable).
   */
  function isLayerClickable(layer: Layer): boolean {
    const style = layer.style as Record<string, unknown> | null | undefined;
    return style?.['isClickable'] !== false;
  }

  /**
   * FSL isSandwiched: when true, FillLayer is inserted before the first basemap symbol
   * layer so polygon fills render beneath basemap labels (road names, city labels, etc.).
   * Defaults to false (undefined → not sandwiched).
   */
  function isLayerSandwiched(layer: Layer): boolean {
    const style = layer.style as Record<string, unknown> | null | undefined;
    return style?.['isSandwiched'] === true;
  }

  /**
   * Convert FSL filters + showOther=false to a MapLibre filter expression.
   * Combines:
   *   1. FSL style.filters (user-defined attribute filters)
   *   2. showOther:false guard (only show features in config.categories list)
   * Returns undefined when no filtering is needed.
   */
  function getLayerFilter(layer: Layer): unknown[] | undefined {
    const style = layer.style as Record<string, unknown> | null | undefined;
    const filters = style?.['filters'];
    const config = style?.['config'] as Record<string, unknown> | undefined;

    const parts: unknown[][] = [];

    // FSL style.filters → MapLibre filter
    if (Array.isArray(filters) && filters.length > 0) {
      const fslResult = fslFiltersToMapLibre(filters);
      if (fslResult) parts.push(fslResult);
    }

    // showOther: false — only render features whose categorical field is in the categories list
    if (
      config?.['showOther'] === false &&
      typeof config['categoricalAttribute'] === 'string' &&
      Array.isArray(config['categories']) &&
      (config['categories'] as unknown[]).length > 0
    ) {
      const field = config['categoricalAttribute'] as string;
      const cats = config['categories'] as string[];
      // MapLibre filter: ["in", ["get", field], ...cats]
      parts.push(['in', ['get', field], ...cats]);
    }

    // Session-level UI filters (ephemeral, not persisted to style)
    const uiFilter = filterStore.toMapLibreFilter(layer.id);
    if (uiFilter) parts.push(uiFilter);

    if (parts.length === 0) return undefined;
    if (parts.length === 1) return parts[0];
    return ['all', ...parts];
  }

  function getSymbolPaint(layer: Layer): NonNullable<SymbolLayerSpecification['paint']> {
    const style = layer.style as Record<string, unknown> | null | undefined;
    const label = style?.['label'] as Record<string, unknown> | undefined;
    return {
      'text-color': (label?.['color'] as string | undefined) ?? '#222222',
      'text-halo-color': (label?.['haloColor'] as string | undefined) ?? '#ffffff',
      'text-halo-width': 1,
    } as unknown as NonNullable<SymbolLayerSpecification['paint']>;
  }

  function getSymbolLayout(layer: Layer, labelAttr: string): NonNullable<SymbolLayerSpecification['layout']> {
    const style = layer.style as Record<string, unknown> | null | undefined;
    const label = style?.['label'] as Record<string, unknown> | undefined;
    return {
      'text-field': ['get', labelAttr],
      'text-size': (label?.['fontSize'] as number | undefined) ?? 12,
      'text-anchor': 'top',
      'text-offset': [0, 0.5],
      'text-max-width': 8,
    } as unknown as NonNullable<SymbolLayerSpecification['layout']>;
  }

  function handleFeatureClick(feature: GeoJSONFeature, e: MapMouseEvent, layerStyle?: LayerStyle) {
    // Block feature clicks during active drawing operations only
    const tool = selectionStore.activeTool;
    if (tool === 'point' || tool === 'line' || tool === 'polygon') return;
    selectedLayerStyle = layerStyle;
    selectionStore.selectFeature(feature, { lng: e.lngLat.lng, lat: e.lngLat.lat });
  }

  // ── Annotation pin popup ──────────────────────────────────────────────────

  /** Style of the layer whose feature is currently selected — drives FeaturePopup formatting. */
  let selectedLayerStyle = $state<LayerStyle | undefined>(undefined);

  /** State for the annotation popup — set when an annotation pin is clicked. */
  interface SelectedAnnotationPopup {
    content: AnnotationContentType;
    authorName: string;
    createdAt: string;
    lngLat: { lng: number; lat: number };
  }

  let selectedAnnotation = $state<SelectedAnnotationPopup | null>(null);

  // handleAnnotationClick is inlined in the template (see CircleLayer onclick below)
  // because svelte-maplibre-gl layer events are MapLayerMouseEvent (has .features),
  // while MapMouseEvent (used for onmoveend etc.) does not carry feature data.

  // Always render all three sublayers (fill + line + circle) per source.
  // MapLibre routes each sublayer to the matching geometry natively:
  //   FillLayer   → Polygon / MultiPolygon only
  //   LineLayer   → LineString / MultiLineString + Polygon outlines
  //   CircleLayer → Point / MultiPoint only
  // No explicit $type filter needed. This means drawn Points are always
  // visible regardless of a layer's declared type (e.g. a 'polygon' layer
  // that has had points drawn into it still shows circles).
</script>

<div class="relative w-full h-full">
  <MapLibre
    style={mapStore.basemapUrl}
    center={{ lng: mapStore.center[0], lat: mapStore.center[1] }}
    zoom={mapStore.zoom}
    bearing={mapStore.bearing}
    pitch={mapStore.pitch}
    class="w-full h-full"
    autoloadGlobalCss={false}
    canvasContextAttributes={{ preserveDrawingBuffer: true }}
    onload={(e) => { mapInstance = e.target as unknown as MapLibreMap; }}
    onmoveend={(e) => {
      const m = e.target as MapLibreMap;
      const c = m.getCenter();
      mapStore.setViewport({ center: [c.lng, c.lat], zoom: m.getZoom() });
    }}
  >
    {#each layersStore.all as layer (layer.id)}
      {#if layer.visible}
        {@const data = layerData[layer.id] ?? { type: 'FeatureCollection', features: [] }}
        {@const isHeatmap = (layer.style as Record<string, unknown>)?.['type'] === 'heatmap'}

        {@const labelAttr = getLabelAttribute(layer)}
        {@const clickable = isLayerClickable(layer)}
        {@const layerFilter = getLayerFilter(layer)}
        {@const sandwiched = isLayerSandwiched(layer)}

        {@const layerStyle = layer.style as LayerStyle | null | undefined}

        <!-- Heatmap layers are rendered by DeckGLOverlay (mounted below). Skip MapLibre. -->
        {#if !isHeatmap && usesVectorTiles(layer)}
          <!-- Martin vector tiles — used for layers above VECTOR_TILE_THRESHOLD features -->
          <VectorTileSource id={`source-${layer.id}`} tiles={[martinTileUrl()]}>
            <FillLayer
              id={`layer-${layer.id}-fill`}
              sourceLayer={MARTIN_SOURCE_LAYER}
              paint={getLayerPaint(layer, 'fill') as unknown as NonNullable<FillLayerSpecification['paint']>}
              filter={getVectorTileFilter(layer) as unknown as NonNullable<FillLayerSpecification['filter']>}
              {...(sandwiched && firstLabelLayerId ? { beforeId: firstLabelLayerId } : {})}
              onclick={(e) => {
                if (!clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, layerStyle ?? undefined);
              }}
            />
            <LineLayer
              id={`layer-${layer.id}-line`}
              sourceLayer={MARTIN_SOURCE_LAYER}
              paint={getLayerPaint(layer, 'line') as unknown as NonNullable<LineLayerSpecification['paint']>}
              filter={getVectorTileFilter(layer) as unknown as NonNullable<LineLayerSpecification['filter']>}
              onclick={(e) => {
                if (!clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, layerStyle ?? undefined);
              }}
            />
            <CircleLayer
              id={`layer-${layer.id}-circle`}
              sourceLayer={MARTIN_SOURCE_LAYER}
              paint={getLayerPaint(layer, 'circle') as unknown as NonNullable<CircleLayerSpecification['paint']>}
              filter={getVectorTileFilter(layer) as unknown as NonNullable<CircleLayerSpecification['filter']>}
              onclick={(e) => {
                if (!clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, layerStyle ?? undefined);
              }}
            />
            {#if labelAttr}
              <SymbolLayer
                id={`layer-${layer.id}-label`}
                sourceLayer={MARTIN_SOURCE_LAYER}
                layout={getSymbolLayout(layer, labelAttr)}
                paint={getSymbolPaint(layer)}
              />
            {/if}
          </VectorTileSource>
        {:else if !isHeatmap}
          <!-- GeoJSON source — used for layers below VECTOR_TILE_THRESHOLD features -->
          <GeoJSONSource id={`source-${layer.id}`} data={data}>
            <FillLayer
              id={`layer-${layer.id}-fill`}
              paint={getLayerPaint(layer, 'fill') as unknown as NonNullable<FillLayerSpecification['paint']>}
              filter={layerFilter as unknown as NonNullable<FillLayerSpecification['filter']>}
              {...(sandwiched && firstLabelLayerId ? { beforeId: firstLabelLayerId } : {})}
              onclick={(e) => {
                if (!clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, layerStyle ?? undefined);
              }}
            />
            <LineLayer
              id={`layer-${layer.id}-line`}
              paint={getLayerPaint(layer, 'line') as unknown as NonNullable<LineLayerSpecification['paint']>}
              filter={layerFilter as unknown as NonNullable<LineLayerSpecification['filter']>}
              onclick={(e) => {
                if (!clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, layerStyle ?? undefined);
              }}
            />
            <CircleLayer
              id={`layer-${layer.id}-circle`}
              paint={getLayerPaint(layer, 'circle') as unknown as NonNullable<CircleLayerSpecification['paint']>}
              filter={layerFilter as unknown as NonNullable<CircleLayerSpecification['filter']>}
              onclick={(e) => {
                if (!clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, layerStyle ?? undefined);
              }}
            />
            {#if labelAttr}
              <!-- FSL labelAttribute: render the chosen property as a text label above each feature -->
              <SymbolLayer
                id={`layer-${layer.id}-label`}
                layout={getSymbolLayout(layer, labelAttr)}
                paint={getSymbolPaint(layer)}
              />
            {/if}
          </GeoJSONSource>
        {/if}
      {/if}
    {/each}

    {#if selectionStore.selectedFeature && selectionStore.popupCoords}
      <Popup
        lnglat={selectionStore.popupCoords}
        closeButton={true}
        onclose={() => { selectionStore.clearSelection(); selectedLayerStyle = undefined; }}
      >
        <FeaturePopup feature={selectionStore.selectedFeature} {...(selectedLayerStyle !== undefined ? { style: selectedLayerStyle } : {})} />
      </Popup>
    {/if}

    <!-- Annotation pins — rendered above data layers, below the feature popup -->
    {#if annotationPins && annotationPins.features.length > 0}
      <GeoJSONSource
        id="source-annotations"
        data={annotationPins as unknown as { type: 'FeatureCollection'; features: GeoJSONFeature[] }}
      >
        <CircleLayer
          id="layer-annotations-circle"
          paint={{
            'circle-radius': 10,
            'circle-color': '#f59e0b',
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.92,
          }}
          onclick={(e) => {
            // Don't interrupt active drawing tools
            const tool = selectionStore.activeTool;
            if (tool === 'point' || tool === 'line' || tool === 'polygon') return;

            const f = e.features?.[0];
            if (!f) return;

            const props = f.properties as AnnotationPinProperties | null;
            if (!props?.contentJson) return;

            let parsed: AnnotationContentType;
            try {
              const raw: unknown = JSON.parse(props.contentJson);
              const result = AnnotationContentSchema.safeParse(raw);
              // Malformed annotation content (schema mismatch or invalid JSON) silently
              // closes the popup — the pin is still visible but unclickable until refreshed.
              if (!result.success) return;
              parsed = result.data;
            } catch {
              // JSON.parse threw — contentJson is not valid JSON.
              return;
            }

            selectedAnnotation = {
              content: parsed,
              authorName: props.authorName,
              createdAt: props.createdAt,
              lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
            };
          }}
        />
      </GeoJSONSource>
    {/if}

    <!-- Annotation popup — shown on pin click; independent of selectionStore -->
    {#if selectedAnnotation}
      <Popup
        lnglat={selectedAnnotation.lngLat}
        closeButton={true}
        onclose={() => { selectedAnnotation = null; }}
      >
        <AnnotationContent
          content={selectedAnnotation.content}
          authorName={selectedAnnotation.authorName}
          createdAt={selectedAnnotation.createdAt}
        />
      </Popup>
    {/if}
  </MapLibre>

  <!-- deck.gl overlay — renders HeatmapLayer for layers with style.type === 'heatmap' -->
  <DeckGLOverlay map={mapInstance} layers={heatmapLayerDefs} />

  {#if !readonly && mapInstance}
    <DrawingToolbar
      map={mapInstance}
      {...(onfeaturedrawn !== undefined ? { onfeaturedrawn } : {})}
      {...(onmeasured !== undefined ? { onmeasured } : {})}
    />
  {/if}
</div>
