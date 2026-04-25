<script lang="ts">
  import { untrack } from 'svelte';
  import { effectEnter, effectExit, mutation } from '$lib/debug/effect-tracker.js';
  import { MapLibre, FeatureState, Popup } from 'svelte-maplibre-gl';
  import maplibregl from 'maplibre-gl';
  import type { Map as MapLibreMap, MapMouseEvent, SymbolLayerSpecification } from 'maplibre-gl';
  import { getMapStore } from '$lib/stores/map.svelte.js';
  const mapStore = getMapStore();
  import { getLayersStore } from '$lib/stores/layers.svelte.js';
  const layersStore = getLayersStore();
  import { getMapEditorState } from '$lib/stores/map-editor-state.svelte.js';
  import type { Layer, GeoJSONFeature } from '@felt-like-it/shared-types';
  import { VECTOR_TILE_THRESHOLD } from '$lib/utils/constants.js';
  import { fslFiltersToMapLibre } from '@felt-like-it/geo-engine';
  import type { DistanceMeasurement, AreaMeasurement } from '@felt-like-it/geo-engine';
  import {
    getHoverAwarePaint,
    getLabelAttribute,
    isLayerClickable,
    isLayerSandwiched,
    getSymbolPaint,
    getSymbolLayout,
    getLayerFilter as getLayerFilterBase,
  } from './map-styles.js';
  import type { FiltersStore } from '$lib/stores/filters-store.svelte.js';
  import DrawingToolbar from './DrawingToolbar.svelte';
  import FeaturePopup from './FeaturePopup.svelte';
  import DeckGLOverlay from './DeckGLOverlay.svelte';
  import DataLayerRenderer from './DataLayerRenderer.svelte';
  import AnnotationRenderer from './AnnotationRenderer.svelte';
  import type { HeatmapLayerDef } from './DeckGLOverlay.svelte';
  import type { LayerStyle } from '@felt-like-it/shared-types';
  import type { AnnotationPinCollection, AnnotationRegionCollection, AnnotationPathCollection } from './AnnotationRenderer.svelte';
  import { PUBLIC_MARTIN_URL } from '$env/static/public';

  // ── Annotated feature highlight + badge computations ────────────────────
  import { centroid } from '@turf/turf';
  import type { Feature, Point } from 'geojson';

  interface Props {
    readonly?: boolean;
    /** GeoJSON data per layer id */
    layerData: Record<string, { type: 'FeatureCollection'; features: GeoJSONFeature[] }>;
    /**
     * Fires after a TerraDraw commit creates an annotation row. Carries the
     * persisted id + anchor type. Pass-through to DrawingToolbar.
     */
    onannotationdrawn?: (_annotation: { id: string; anchorType: 'point' | 'path' | 'region' | 'feature' | 'viewport' | 'measurement' }) => void;
    /**
     * Annotation pins rendered as a dedicated amber circle layer.
     * Omit (or pass undefined) to hide annotation pins — used in the share viewer.
     */
    annotationPins?: AnnotationPinCollection;
    /**
     * When provided, the drawing toolbar enters measurement mode: drawn features
     * are NOT saved to any layer — instead the computed MeasurementResult is passed here.
     */
    onmeasured?: (_result: DistanceMeasurement | AreaMeasurement) => void;
    /**
     * When provided, the next drawn polygon is captured as an annotation region.
     */
    onregiondrawn?: (_geometry: { type: 'Polygon'; coordinates: number[][][] }) => void;
    /**
     * Region-anchored annotation polygons rendered as a dedicated fill layer.
     */
    annotationRegions?: AnnotationRegionCollection;
    /**
     * Path-anchored annotation lines rendered as a dedicated line layer. Added
     * per unified-annotations.md rule 1 (line features convert to `path`).
     */
    annotationPaths?: AnnotationPathCollection;
    /** Feature IDs that have annotations — used for highlight sublayers and badge indicators. */
    annotatedFeatures?: Map<string, { layerId: string; count: number }>;
    /** Called when a feature annotation badge is clicked. */
    onbadgeclick?: (_featureId: string) => void;
    /** Measurement annotation geometries rendered as dashed lines/fills. */
    measurementAnnotations?: { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }[] };
    /** Map-scoped filter store (owned by MapEditor). When omitted, no UI filters are applied. */
    filtersStore?: FiltersStore;
    /**
     * Called when the user clicks the "Annotate" CTA inside the FeaturePopup —
     * per unified-annotations.md rule 3, the feature popup routes into the
     * annotation panel instead of a dedicated attribute editor.
     */
    onfeatureannotate?: (_payload: { featureId: string; layerId: string }) => void;
  }

  let { readonly = false, layerData, onannotationdrawn, annotationPins, onmeasured, onregiondrawn, annotationRegions, annotationPaths, annotatedFeatures, onbadgeclick, measurementAnnotations, filtersStore, onfeatureannotate }: Props = $props();

  const editorState = getMapEditorState();
  let mapInstance = $state<MapLibreMap | undefined>(undefined);

  // Sync map instance to global store
  $effect(() => {
    effectEnter('MC:syncMapInstance', { hasInstance: !!mapInstance });
    mapStore.setMapInstance(mapInstance);
    effectExit('MC:syncMapInstance');
  });

  // ── Viewport sync: unidirectional during interaction, push on loadViewport ─
  // $state.raw — replaced wholesale (`mapCenter = { lng, lat }`); never mutated in place.
  let mapCenter = $state.raw<maplibregl.LngLatLike>({ lng: mapStore.center[0], lat: mapStore.center[1] });
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
    mutation('MC', 'layerRenderCache→recompute', { layerCount: layersStore.all.length });
    const result: Record<string, LayerRenderCache> = {};
    for (const layer of layersStore.all) {
      if (!layer.visible) continue;
      const labelAttr = getLabelAttribute(layer);
      const style = layer.style as LayerStyle | null | undefined;
      const highlightColor = (style as Record<string, unknown> | null | undefined)?.['highlightColor'] as string | undefined;
      result[layer.id] = {
        fillPaint: getHoverAwarePaint(layer, 'fill', highlightColor),
        linePaint: getHoverAwarePaint(layer, 'line', highlightColor),
        circlePaint: getHoverAwarePaint(layer, 'circle', highlightColor),
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

  /** Wrapper: pure FSL filter + reactive session-level UI filters from filtersStore prop. */
  function getLayerFilter(layer: Layer): unknown[] | undefined {
    const baseFilter = getLayerFilterBase(layer, fslFiltersToMapLibre);
    const uiFilter = filtersStore?.toMapLibreFilter(layer.id);
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
  // Deduplicate by DOM event identity: overlapping layers fire separate MapLibre
  // events but share the same originalEvent object. Only the first handler wins.
  let _lastClickEvent: MouseEvent | null = null;

  /** Style of the layer whose feature is currently selected — drives FeaturePopup formatting. */
  let selectedLayerStyle = $state<LayerStyle | undefined>(undefined);

  function handleFeatureClick(feature: GeoJSONFeature, e: MapMouseEvent, layerStyle?: LayerStyle, layerId?: string) {
    mutation('MC', 'handleFeatureClick', { featureId: feature.id, layerId, tool: editorState.activeTool });
    const tool = editorState.activeTool;
    if (tool === 'point' || tool === 'line' || tool === 'polygon') return;

    if (e.originalEvent === _lastClickEvent) return;
    _lastClickEvent = e.originalEvent;

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
  <!-- TYPE_DEBT: svelte-maplibre-gl's Props type marks `map` as required,
       but bind:map writes it post-mount — the undefined initial value is fine. -->
  <MapLibre
    style={mapStore.basemapUrl}
    bind:map={mapInstance as unknown as maplibregl.Map}
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

    {#if editorState.selectedFeature?.id != null && editorState.selectedLayerId}
      <FeatureState
        id={editorState.selectedFeature.id}
        source={`source-${editorState.selectedLayerId}`}
        state={{ selected: true }}
      />
    {/if}

    {#if editorState.selectedFeature && editorState.popupCoords}
      <Popup
        lnglat={editorState.popupCoords}
        closeButton={true}
        onclose={() => { editorState.clearSelection(); selectedLayerStyle = undefined; }}
      >
        <FeaturePopup
          feature={editorState.selectedFeature}
          {...(selectedLayerStyle !== undefined ? { style: selectedLayerStyle } : {})}
          {...(onfeatureannotate && editorState.selectedLayerId && editorState.selectedFeature.id != null
            ? {
                onannotate: () => {
                  const fid = String(editorState.selectedFeature!.id);
                  const lid = editorState.selectedLayerId!;
                  onfeatureannotate({ featureId: fid, layerId: lid });
                },
              }
            : {})}
        />
      </Popup>
    {/if}

    <AnnotationRenderer
      {annotationPins}
      {annotationRegions}
      {annotationPaths}
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
      {...(onannotationdrawn !== undefined ? { onannotationdrawn } : {})}
      {...(onmeasured !== undefined ? { onmeasured } : {})}
      {...(onregiondrawn !== undefined ? { onregiondrawn } : {})}
    />
  {/if}
</div>
