<script lang="ts">
  import { untrack } from 'svelte';
  import { effectEnter, effectExit, mutation } from '$lib/debug/effect-tracker.js';
  import { MapLibre, FeatureState, Popup } from 'svelte-maplibre-gl';
  import maplibregl from 'maplibre-gl';
  import type { Map as MapLibreMap, MapMouseEvent, SymbolLayerSpecification } from 'maplibre-gl';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { getMapEditorState } from '$lib/stores/map-editor-state.svelte.js';
  import type { Layer, GeoJSONFeature } from '@felt-like-it/shared-types';
  import { VECTOR_TILE_THRESHOLD } from '$lib/utils/constants.js';
  import { fslFiltersToMapLibre } from '@felt-like-it/geo-engine';
  import type { MeasurementResult } from '@felt-like-it/geo-engine';
  import {
    getHoverAwarePaint,
    applyHighlight,
    getLabelAttribute,
    isLayerClickable,
    isLayerSandwiched,
    getSymbolPaint,
    getSymbolLayout,
    getLayerFilter as getLayerFilterBase,
  } from './map-styles.js';
  import { filterStore } from '$lib/stores/filters.svelte.js';
  import DrawingToolbar from './DrawingToolbar.svelte';
  import FeaturePopup from './FeaturePopup.svelte';
  import DeckGLOverlay from './DeckGLOverlay.svelte';
  import DataLayerRenderer from './DataLayerRenderer.svelte';
  import AnnotationRenderer from './AnnotationRenderer.svelte';
  import type { HeatmapLayerDef } from './DeckGLOverlay.svelte';
  import type { LayerStyle } from '@felt-like-it/shared-types';
  import type { AnnotationPinCollection, AnnotationRegionCollection } from './AnnotationRenderer.svelte';
  import { PUBLIC_MARTIN_URL } from '$env/static/public';

  // ── Annotated feature highlight + badge computations ────────────────────
  import { centroid } from '@turf/turf';
  import type { Feature, Point } from 'geojson';

  interface Props {
    readonly?: boolean;
    /** GeoJSON data per layer id */
    layerData: Record<string, { type: 'FeatureCollection'; features: GeoJSONFeature[] }>;
    onfeaturedrawn?: (_layerId: string, _feature: Record<string, unknown> & { id?: string | undefined }) => void;
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
    /**
     * When provided, the next drawn polygon is captured as an annotation region.
     */
    onregiondrawn?: (_geometry: { type: 'Polygon'; coordinates: number[][][] }) => void;
    /**
     * Region-anchored annotation polygons rendered as a dedicated fill layer.
     */
    annotationRegions?: AnnotationRegionCollection;
    /** Feature IDs that have annotations — used for highlight sublayers and badge indicators. */
    annotatedFeatures?: Map<string, { layerId: string; count: number }>;
    /** Called when a feature annotation badge is clicked. */
    onbadgeclick?: (_featureId: string) => void;
    /** Measurement annotation geometries rendered as dashed lines/fills. */
    measurementAnnotations?: { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }[] };
  }

  let { readonly = false, layerData, onfeaturedrawn, annotationPins, onmeasured, onregiondrawn, annotationRegions, annotatedFeatures, onbadgeclick, measurementAnnotations }: Props = $props();

  const editorState = getMapEditorState();
  let mapInstance = $state<MapLibreMap | undefined>(undefined);

  // Sync map instance to global store
  $effect(() => {
    effectEnter('MC:syncMapInstance', { hasInstance: !!mapInstance });
    mapStore.setMapInstance(mapInstance);
    effectExit('MC:syncMapInstance');
  });

  // ── Viewport sync: unidirectional during interaction, push on loadViewport ─
  let mapCenter = $state<maplibregl.LngLatLike>({ lng: mapStore.center[0], lat: mapStore.center[1] });
  let mapZoom = $state<number>(mapStore.zoom);
  let mapBearing = $state<number>(mapStore.bearing);
  let mapPitch = $state<number>(mapStore.pitch);

  // Store → local (only fires when loadViewport increments viewportVersion)
  $effect(() => {
    const _version = mapStore.viewportVersion; // sole tracked dependency
    effectEnter('MC:storeToLocal', { version: _version });
    untrack(() => {
      const [lng, lat] = mapStore.center;
      const z = mapStore.zoom;
      const b = mapStore.bearing;
      const p = mapStore.pitch;
      const cur = mapCenter as { lng: number; lat: number };
      if (cur.lng !== lng || cur.lat !== lat) { mutation('MC', 'mapCenter'); mapCenter = { lng, lat }; }
      if (mapZoom !== z) { mutation('MC', 'mapZoom'); mapZoom = z; }
      if (mapBearing !== b) { mutation('MC', 'mapBearing'); mapBearing = b; }
      if (mapPitch !== p) { mutation('MC', 'mapPitch'); mapPitch = p; }
    });
    effectExit('MC:storeToLocal');
  });

  // Local → store (fires when the library's move handler updates bound values)
  $effect(() => {
    const c = mapCenter as { lng: number; lat: number };
    const z = mapZoom;
    effectEnter('MC:localToStore', { lng: c.lng.toFixed(4), lat: c.lat.toFixed(4), z: z.toFixed(2) });
    untrack(() => {
      mapStore.setViewport({ center: [c.lng, c.lat], zoom: z });
    });
    effectExit('MC:localToStore');
  });

  /**
   * ID of the first basemap symbol layer (e.g. road labels, city names).
   * Computed once the map is loaded; used by isSandwiched to position FillLayers
   * beneath basemap text so polygon fills don't obscure map labels.
   */
  let firstLabelLayerId = $state<string | undefined>(undefined);
  $effect(() => {
    effectEnter('MC:firstLabelLayer', { hasInstance: !!mapInstance });
    if (!mapInstance) { firstLabelLayerId = undefined; effectExit('MC:firstLabelLayer'); return; }
    function updateFirstLabel() {
      const newId = mapInstance!.getStyle()?.layers.find((l) => l.type === 'symbol')?.id;
      if (newId !== firstLabelLayerId) {
        mutation('MC', 'firstLabelLayerId', newId);
        firstLabelLayerId = newId;
      }
    }
    updateFirstLabel();
    mapInstance.on('style.load', updateFirstLabel);
    effectExit('MC:firstLabelLayer');
    return () => { mapInstance!.off('style.load', updateFirstLabel); };
  });

  /**
   * Layers that should be rendered by deck.gl instead of MapLibre.
   * Currently only style.type === 'heatmap' (point-only kernel density).
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
          ...(weightAttr !== undefined ? { weightAttribute: weightAttr } : {}),
        };
      })
  );

  /**
   * Whether this layer should be rendered via Martin vector tiles.
   */
  function usesVectorTiles(layer: Layer): boolean {
    return (
      PUBLIC_MARTIN_URL.length > 0 &&
      (layer.featureCount ?? 0) > VECTOR_TILE_THRESHOLD
    );
  }

  /**
   * Combined MapLibre filter for a vector tile layer.
   */
  function getVectorTileFilter(layer: Layer): unknown[] {
    const baseFilter = getLayerFilter(layer);
    const layerIdFilter: unknown[] = ['==', ['get', 'layer_id'], layer.id];
    if (!baseFilter) return layerIdFilter;
    return ['all', layerIdFilter, baseFilter];
  }

  // Stable canvas context attributes
  const CANVAS_CTX_ATTRS = { preserveDrawingBuffer: true };

  // ── Memoized per-layer render props ───────────────────────────────────────
  interface LayerRenderCache {
    fillPaint: Record<string, unknown>;
    linePaint: Record<string, unknown>;
    circlePaint: Record<string, unknown>;
    symbolPaint: NonNullable<SymbolLayerSpecification['paint']> | null;
    symbolLayout: NonNullable<SymbolLayerSpecification['layout']> | null;
    filter: unknown[] | undefined;
    vtFilter: unknown[];
    labelAttr: string | undefined;
    clickable: boolean;
    sandwiched: boolean;
    isHeatmap: boolean;
    usesVT: boolean;
    layerStyle: LayerStyle | null | undefined;
  }

  const layerRenderCache = $derived.by<Record<string, LayerRenderCache>>(() => {
    mutation('MC', 'layerRenderCache→recompute', { layerCount: layersStore.all.length, selectedFeat: editorState.selectedFeature?.id });
    const result: Record<string, LayerRenderCache> = {};
    for (const layer of layersStore.all) {
      if (!layer.visible) continue;
      const labelAttr = getLabelAttribute(layer);
      const style = layer.style as LayerStyle | null | undefined;
      const highlightColor = (style as Record<string, unknown> | null | undefined)?.['highlightColor'] as string | undefined;
      const selectedFeature = editorState.selectedFeature;
      result[layer.id] = {
        fillPaint: applyHighlight(getHoverAwarePaint(layer, 'fill'), 'fill', highlightColor, selectedFeature?.id),
        linePaint: applyHighlight(getHoverAwarePaint(layer, 'line'), 'line', highlightColor, selectedFeature?.id),
        circlePaint: applyHighlight(getHoverAwarePaint(layer, 'circle'), 'circle', highlightColor, selectedFeature?.id),
        symbolPaint: labelAttr ? getSymbolPaint(layer) : null,
        symbolLayout: labelAttr ? getSymbolLayout(layer, labelAttr) : null,
        filter: getLayerFilter(layer),
        vtFilter: getVectorTileFilter(layer),
        labelAttr,
        clickable: isLayerClickable(layer),
        sandwiched: isLayerSandwiched(layer),
        isHeatmap: (layer.style as Record<string, unknown>)?.['type'] === 'heatmap',
        usesVT: usesVectorTiles(layer),
        layerStyle: style,
      };
    }
    return result;
  });

  /** Wrapper: pure FSL filter + reactive session-level UI filters from filterStore. */
  function getLayerFilter(layer: Layer): unknown[] | undefined {
    const baseFilter = getLayerFilterBase(layer, fslFiltersToMapLibre);
    const uiFilter = filterStore.toMapLibreFilter(layer.id);
    if (!baseFilter && !uiFilter) return undefined;
    const parts: unknown[][] = [];
    if (baseFilter) parts.push(baseFilter);
    if (uiFilter) parts.push(uiFilter);
    if (parts.length === 1) return parts[0];
    return ['all', ...parts];
  }

  // ── Hover state for FeatureState ──────────────────────────────────────────
  let hoveredFeature = $state<{ id: string | number; source: string; layerId: string } | null>(null);

  // ── Feature click handling ────────────────────────────────────────────────
  let _lastClickTs = 0;
  const CLICK_DEDUP_MS = 300;

  /** Style of the layer whose feature is currently selected — drives FeaturePopup formatting. */
  let selectedLayerStyle = $state<LayerStyle | undefined>(undefined);

  function handleFeatureClick(feature: GeoJSONFeature, e: MapMouseEvent, layerStyle?: LayerStyle, layerId?: string) {
    mutation('MC', 'handleFeatureClick', { featureId: feature.id, layerId, tool: editorState.activeTool });
    const tool = editorState.activeTool;
    if (tool === 'point' || tool === 'line' || tool === 'polygon') return;

    const now = performance.now();
    if (now - _lastClickTs < CLICK_DEDUP_MS) return;
    _lastClickTs = now;

    const coords = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    queueMicrotask(() => {
      mutation('MC', 'handleFeatureClick→microtask', { featureId: feature.id });
      selectedLayerStyle = layerStyle;
      editorState.selectFeature(feature, coords, layerId);
    });
  }

  // ── Annotated feature highlight + badge computations ────────────────────
  const annotatedByLayer = $derived.by(() => {
    const map = new Map<string, string[]>();
    if (!annotatedFeatures?.size) return map;
    for (const [featureId, info] of annotatedFeatures) {
      const list = map.get(info.layerId) ?? [];
      list.push(featureId);
      map.set(info.layerId, list);
    }
    return map;
  });

  const badgeGeoJson = $derived.by(() => {
    const features: Feature<Point>[] = [];
    if (!annotatedFeatures?.size) return { type: 'FeatureCollection' as const, features };
    for (const [featureId, info] of annotatedFeatures) {
      const ld = layerData[info.layerId];
      if (!ld) continue;
      const feat = ld.features.find((f) => String(f.id ?? '') === featureId);
      if (!feat) continue;
      try {
        const c = centroid(feat as Feature);
        features.push({
          type: 'Feature',
          geometry: c.geometry,
          properties: { count: info.count, featureId },
        });
      } catch { /* skip features centroid can't handle */ }
    }
    return { type: 'FeatureCollection' as const, features };
  });
</script>

<div class="relative w-full h-full">
  <MapLibre
    style={mapStore.basemapUrl}
    bind:map={mapInstance as maplibregl.Map | undefined}
    bind:center={mapCenter}
    bind:zoom={mapZoom}
    bind:bearing={mapBearing}
    bind:pitch={mapPitch}
    class="w-full h-full"
    autoloadGlobalCss={false}
    canvasContextAttributes={CANVAS_CTX_ATTRS}
  >
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

    {#if hoveredFeature}
      <FeatureState
        id={hoveredFeature.id}
        source={hoveredFeature.source}
        state={{ hover: true }}
      />
    {/if}

    {#if editorState.selectedFeature && editorState.popupCoords}
      <Popup
        lnglat={editorState.popupCoords}
        closeButton={true}
        onclose={() => { editorState.clearSelection(); selectedLayerStyle = undefined; }}
      >
        <FeaturePopup feature={editorState.selectedFeature} {...(selectedLayerStyle !== undefined ? { style: selectedLayerStyle } : {})} />
      </Popup>
    {/if}

    <AnnotationRenderer
      {annotationPins}
      {annotationRegions}
      {badgeGeoJson}
      {measurementAnnotations}
      {onbadgeclick}
    />
  </MapLibre>

  <!-- deck.gl overlay — renders HeatmapLayer for layers with style.type === 'heatmap' -->
  <DeckGLOverlay map={mapInstance} layers={heatmapLayerDefs} />

  {#if !readonly && mapInstance}
    <DrawingToolbar
      map={mapInstance}
      {...(onfeaturedrawn !== undefined ? { onfeaturedrawn } : {})}
      {...(onmeasured !== undefined ? { onmeasured } : {})}
      {...(onregiondrawn !== undefined ? { onregiondrawn } : {})}
    />
  {/if}
</div>
