<script lang="ts">
  import { untrack } from 'svelte';
  import { effectEnter, effectExit, mutation } from '$lib/debug/effect-tracker.js';
  import { MapLibre, GeoJSONSource, VectorTileSource, CircleLayer, LineLayer, FillLayer, SymbolLayer, Popup } from 'svelte-maplibre-gl';
  import maplibregl from 'maplibre-gl';
  import type { Map as MapLibreMap, MapMouseEvent, FillLayerSpecification, LineLayerSpecification, CircleLayerSpecification, SymbolLayerSpecification } from 'maplibre-gl';
  import { PUBLIC_MARTIN_URL } from '$env/static/public';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import { layersStore } from '$lib/stores/layers.svelte.js';
  import { selectionStore } from '$lib/stores/selection.svelte.js';
  import type { Layer, GeoJSONFeature } from '@felt-like-it/shared-types';
  import { VECTOR_TILE_THRESHOLD } from '$lib/utils/constants.js';
  import { fslFiltersToMapLibre, resolvePaintInterpolators } from '@felt-like-it/geo-engine';
  import type { MeasurementResult } from '@felt-like-it/geo-engine';
  import { filterStore } from '$lib/stores/filters.svelte.js';
  import { hotOverlay } from '$lib/utils/map-sources.svelte.js';
  import DrawingToolbar from './DrawingToolbar.svelte';
  import FeaturePopup from './FeaturePopup.svelte';
  import AnnotationContent from '$lib/components/annotations/AnnotationContent.svelte';
  import DeckGLOverlay from './DeckGLOverlay.svelte';
  import { AnnotationObjectContentSchema } from '@felt-like-it/shared-types';
  import type { AnnotationObjectContent } from '@felt-like-it/shared-types';
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
    anchorType?: string;
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

  interface AnnotationRegion {
    type: 'Feature';
    id: string;
    geometry: { type: 'Polygon'; coordinates: number[][][] };
    properties: AnnotationPinProperties;
  }

  export interface AnnotationRegionCollection {
    type: 'FeatureCollection';
    features: AnnotationRegion[];
  }

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

  let mapInstance = $state<MapLibreMap | undefined>(undefined);

  // Sync map instance to global store
  $effect(() => {
    effectEnter('MC:syncMapInstance', { hasInstance: !!mapInstance });
    mapStore.setMapInstance(mapInstance);
    effectExit('MC:syncMapInstance');
  });

  // ── Viewport sync: unidirectional during interaction, push on loadViewport ─
  // Data flow during user pan/zoom (unidirectional, no cycle):
  //   MapLibre move handler → bound local $state (mapCenter, mapZoom, …)
  //   → MC:localToStore effect → mapStore.setViewport()        [terminal]
  //
  // Data flow on programmatic change (loadViewport):
  //   mapStore.loadViewport() increments viewportVersion
  //   → MC:storeToLocal effect → local $state → library binding updates map
  //
  // MC:storeToLocal tracks ONLY viewportVersion (not center/zoom/bearing/pitch)
  // so setViewport() calls from MC:localToStore never re-trigger it.
  //
  // IMPORTANT: Initialize from mapStore — NOT undefined. The library's internal
  // move handler has two branches: if (center) writes only on change (safe),
  // else writes tr.center on EVERY frame (creates undefined→value transition
  // that cascades into effect_update_depth_exceeded). Seeding real values keeps
  // us on the safe branch from the first frame.
  let mapCenter = $state<maplibregl.LngLatLike>({ lng: mapStore.center[0], lat: mapStore.center[1] });
  let mapZoom = $state<number>(mapStore.zoom);
  let mapBearing = $state<number>(mapStore.bearing);
  let mapPitch = $state<number>(mapStore.pitch);

  // Store → local (only fires when loadViewport increments viewportVersion)
  // IMPORTANT: We track ONLY viewportVersion here, NOT center/zoom/bearing/pitch.
  // Reading the actual values is done inside untrack() to avoid creating a
  // reactive dependency on them. This prevents the MC:localToStore ↔ MC:storeToLocal
  // cycle: setViewport (called by localToStore) does NOT increment viewportVersion,
  // so this effect stays dormant during normal map pan/zoom animations.
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

  // Stable fallback — avoids creating a new empty FeatureCollection on every render.
  const EMPTY_COLLECTION: { type: 'FeatureCollection'; features: GeoJSONFeature[] } = { type: 'FeatureCollection', features: [] };

  // Stable canvas context attributes — new object literal on every render would
  // cause svelte-maplibre-gl to re-create the canvas.
  const CANVAS_CTX_ATTRS = { preserveDrawingBuffer: true };

  // Stable paint objects for non-data layers — avoids creating new references per render.
  const ANNOTATION_PIN_PAINT = {
    'circle-radius': 10, 'circle-color': '#f59e0b',
    'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff', 'circle-opacity': 0.92,
  };
  const ANNOTATION_REGION_FILL_PAINT = { 'fill-color': '#3b82f6', 'fill-opacity': 0.15 };
  const ANNOTATION_REGION_LINE_PAINT = { 'line-color': '#3b82f6', 'line-width': 2, 'line-opacity': 0.6 };
  const ANNOTATION_HIGHLIGHT_PAINT = { 'line-color': '#f59e0b', 'line-width': 3, 'line-opacity': 0.6 };
  const BADGE_CIRCLE_PAINT = {
    'circle-radius': 8, 'circle-color': '#f59e0b',
    'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
  };
  const BADGE_LABEL_LAYOUT = {
    'text-field': ['to-string', ['get', 'count']], 'text-size': 10, 'text-allow-overlap': true,
  } as any;
  const BADGE_LABEL_PAINT = { 'text-color': '#ffffff' };
  const MEASURE_LINE_PAINT = { 'line-color': '#f59e0b', 'line-width': 2, 'line-dasharray': [4, 2], 'line-opacity': 0.8 };
  const MEASURE_FILL_PAINT = { 'fill-color': '#f59e0b', 'fill-opacity': 0.1 };
  const MEASURE_LABEL_LAYOUT = {
    'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, -1.5], 'text-allow-overlap': false,
  } as any;
  const MEASURE_LABEL_PAINT = { 'text-color': '#f59e0b', 'text-halo-color': '#1e293b', 'text-halo-width': 1.5 };
  const LINESTRING_FILTER = ['==', '$type', 'LineString'] as any;
  const POLYGON_FILTER = ['==', '$type', 'Polygon'] as any;

  // ── Memoized per-layer render props ───────────────────────────────────────
  // CRITICAL: function calls in the template (getLayerPaint, getLayerFilter, etc.)
  // create new objects on every template re-evaluation. svelte-maplibre-gl compares
  // by reference: new paint object → setPaintProperty → MapLibre render → tile
  // events → template re-evaluates → new paint object → INFINITE LOOP.
  //
  // This $derived.by caches all per-layer props. It only recomputes when its
  // tracked dependencies change (layersStore.all, selectionStore, filterStore),
  // NOT on every template re-evaluation from unrelated state changes.
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
    mutation('MC', 'layerRenderCache→recompute', { layerCount: layersStore.all.length, selectedFeat: selectionStore.selectedFeature?.id });
    const result: Record<string, LayerRenderCache> = {};
    for (const layer of layersStore.all) {
      if (!layer.visible) continue;
      const labelAttr = getLabelAttribute(layer);
      const style = layer.style as LayerStyle | null | undefined;
      result[layer.id] = {
        fillPaint: getLayerPaint(layer, 'fill'),
        linePaint: getLayerPaint(layer, 'line'),
        circlePaint: getLayerPaint(layer, 'circle'),
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

  function getLayerPaint(layer: Layer, paintType: 'circle' | 'line' | 'fill') {
    const style = layer.style as Record<string, unknown> | null | undefined;
    const rawPaint = (style?.['paint'] as Record<string, unknown>) ?? {};

    // Resolve FSL zoom interpolators (e.g. { linear: [[10,2],[16,8]] }) → MapLibre expressions
    const paint = resolvePaintInterpolators(rawPaint);

    // Only return paint properties relevant to this layer type — skip null/undefined
    // values that can leak from JSONB storage and crash MapLibre ("Expected number, found null").
    // Also sanitize MapLibre expressions: replace null fallback values with the property's
    // default so MapLibre doesn't warn (e.g. ["case", pred, val, null] → ["case", pred, val, default]).
    const filtered: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(paint)) {
      if (key.startsWith(paintType + '-') && value != null) {
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
    // Guard: JSONB can store null for highlightColor — treat null as absent.
    const highlightColor = style?.['highlightColor'] as string | undefined;
    const selectedFeature = selectionStore.selectedFeature;
    if (highlightColor != null && selectedFeature !== null && selectedFeature.id !== undefined) {
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

  // TYPE_DEBT: getSymbolPaint/getSymbolLayout return object literals cast to MapLibre spec unions.
  // The spec types are strict discriminated unions; our dynamic builders produce compatible shapes
  // but TypeScript can't verify the union narrowing. Runtime-safe — MapLibre validates on use.
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

  function handleFeatureClick(feature: GeoJSONFeature, e: MapMouseEvent, layerStyle?: LayerStyle, layerId?: string) {
    mutation('MC', 'handleFeatureClick', { featureId: feature.id, layerId, tool: selectionStore.activeTool });
    // Block feature clicks during active drawing operations only
    const tool = selectionStore.activeTool;
    if (tool === 'point' || tool === 'line' || tool === 'polygon') return;
    // Defer state writes to a fresh microtask. MapLibre click handlers can fire
    // during Svelte's initial effect flush (e.g. if the user clicks while the page
    // is loading). Writing state synchronously would add to the current flush
    // iteration counter — which already consumed ~900+ iterations mounting all the
    // map layers — and exceed Svelte 5's 1000-iteration depth limit.
    const coords = { lng: e.lngLat.lng, lat: e.lngLat.lat };
    queueMicrotask(() => {
      mutation('MC', 'handleFeatureClick→microtask', { featureId: feature.id });
      selectedLayerStyle = layerStyle;
      selectionStore.selectFeature(feature, coords, layerId);
    });
  }

  // ── Annotation pin popup ──────────────────────────────────────────────────

  /** Style of the layer whose feature is currently selected — drives FeaturePopup formatting. */
  let selectedLayerStyle = $state<LayerStyle | undefined>(undefined);

  /** State for the annotation popup — set when an annotation pin is clicked. */
  interface SelectedAnnotationPopup {
    content: AnnotationObjectContent;
    authorName: string;
    createdAt: string;
    anchorType: string;
    lngLat: { lng: number; lat: number };
  }

  let selectedAnnotation = $state<SelectedAnnotationPopup | null>(null);

  /** Lightweight hover tooltip — shown on mouseenter, hidden on mouseleave. */
  let hoveredAnnotation = $state<SelectedAnnotationPopup | null>(null);

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

  // ── Annotated feature highlight + badge computations ────────────────────
  import { centroid } from '@turf/turf';
  import type { Feature, Point } from 'geojson';

  // Group annotated feature IDs by layerId for highlight filters
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

  // Build badge indicator GeoJSON from annotated features + actual geometries
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
    {#each layersStore.all as layer (layer.id)}
      {#if layer.visible}
        {@const lrc = layerRenderCache[layer.id]}
        {@const data = layerData[layer.id] ?? EMPTY_COLLECTION}

        <!-- TYPE_DEBT: paint/filter casts below — our dynamic builders return Record<string,unknown>
             but svelte-maplibre-gl props expect strict MapLibre spec union types. Runtime-safe;
             svelte-maplibre-gl validates before passing to MapLibre. Same applies to onclick
             feature casts: svelte-maplibre-gl returns its own feature type, not maplibre-gl's
             GeoJSONFeature — structurally compatible at runtime. -->
        <!-- Heatmap layers are rendered by DeckGLOverlay (mounted below). Skip MapLibre. -->
        {#if lrc && !lrc.isHeatmap && lrc.usesVT}
          <!-- Martin vector tiles — used for layers above VECTOR_TILE_THRESHOLD features -->
          <VectorTileSource id={`source-${layer.id}`} tiles={[martinTileUrl()]}>
            <FillLayer
              id={`layer-${layer.id}-fill`}
              sourceLayer={MARTIN_SOURCE_LAYER}
              paint={lrc.fillPaint as unknown as NonNullable<FillLayerSpecification['paint']>}
              filter={lrc.vtFilter as unknown as NonNullable<FillLayerSpecification['filter']>}
              {...(lrc.sandwiched && firstLabelLayerId ? { beforeId: firstLabelLayerId } : {})}
              onclick={(e) => {
                if (!lrc.clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, lrc.layerStyle ?? undefined, layer.id);
              }}
            />
            <LineLayer
              id={`layer-${layer.id}-line`}
              sourceLayer={MARTIN_SOURCE_LAYER}
              paint={lrc.linePaint as unknown as NonNullable<LineLayerSpecification['paint']>}
              filter={lrc.vtFilter as unknown as NonNullable<LineLayerSpecification['filter']>}
              onclick={(e) => {
                if (!lrc.clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, lrc.layerStyle ?? undefined, layer.id);
              }}
            />
            <CircleLayer
              id={`layer-${layer.id}-circle`}
              sourceLayer={MARTIN_SOURCE_LAYER}
              paint={lrc.circlePaint as unknown as NonNullable<CircleLayerSpecification['paint']>}
              filter={lrc.vtFilter as unknown as NonNullable<CircleLayerSpecification['filter']>}
              onclick={(e) => {
                if (!lrc.clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, lrc.layerStyle ?? undefined, layer.id);
              }}
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
          <!-- GeoJSON source — used for layers below VECTOR_TILE_THRESHOLD features -->
          <GeoJSONSource id={`source-${layer.id}`} data={data}>
            <FillLayer
              id={`layer-${layer.id}-fill`}
              paint={lrc.fillPaint as unknown as NonNullable<FillLayerSpecification['paint']>}
              filter={lrc.filter as unknown as NonNullable<FillLayerSpecification['filter']>}
              {...(lrc.sandwiched && firstLabelLayerId ? { beforeId: firstLabelLayerId } : {})}
              onclick={(e) => {
                if (!lrc.clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, lrc.layerStyle ?? undefined, layer.id);
              }}
            />
            <LineLayer
              id={`layer-${layer.id}-line`}
              paint={lrc.linePaint as unknown as NonNullable<LineLayerSpecification['paint']>}
              filter={lrc.filter as unknown as NonNullable<LineLayerSpecification['filter']>}
              onclick={(e) => {
                if (!lrc.clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, lrc.layerStyle ?? undefined, layer.id);
              }}
            />
            <CircleLayer
              id={`layer-${layer.id}-circle`}
              paint={lrc.circlePaint as unknown as NonNullable<CircleLayerSpecification['paint']>}
              filter={lrc.filter as unknown as NonNullable<CircleLayerSpecification['filter']>}
              onclick={(e) => {
                if (!lrc.clickable) return;
                const f = e.features?.[0];
                if (f) handleFeatureClick(f as unknown as GeoJSONFeature, e, lrc.layerStyle ?? undefined, layer.id);
              }}
            />
            {#if lrc.labelAttr && lrc.symbolLayout && lrc.symbolPaint}
              <!-- FSL labelAttribute: render the chosen property as a text label above each feature -->
              <SymbolLayer
                id={`layer-${layer.id}-label`}
                layout={lrc.symbolLayout}
                paint={lrc.symbolPaint}
              />
            {/if}
            {@const highlightIds = annotatedByLayer.get(layer.id)}
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

    <!-- Hot overlay — renders recently drawn features for large (vector tile) layers
         so they appear instantly before the next tile rebuild. Uses the same
         Fill+Line+Circle sublayer pattern as the main GeoJSON sources. -->
    {#each layersStore.all as layer (layer.id)}
      {@const hotLrc = layerRenderCache[layer.id]}
      {#if layer.visible && hotLrc?.usesVT}
        {@const hotCollection = hotOverlay.getCollection(layer.id)}
        {#if hotCollection.features.length > 0}
          <GeoJSONSource id={`hot-overlay-${layer.id}`} data={hotCollection as unknown as { type: 'FeatureCollection'; features: GeoJSONFeature[] }}>
            <FillLayer
              id={`hot-overlay-${layer.id}-fill`}
              paint={hotLrc.fillPaint as unknown as NonNullable<FillLayerSpecification['paint']>}
            />
            <LineLayer
              id={`hot-overlay-${layer.id}-line`}
              paint={hotLrc.linePaint as unknown as NonNullable<LineLayerSpecification['paint']>}
            />
            <CircleLayer
              id={`hot-overlay-${layer.id}-circle`}
              paint={hotLrc.circlePaint as unknown as NonNullable<CircleLayerSpecification['paint']>}
            />
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
      <!-- TYPE_DEBT: AnnotationPinCollection uses typed geometry but GeoJSONSource expects maplibre-gl types -->
      <GeoJSONSource
        id="source-annotations"
        data={annotationPins as unknown as { type: 'FeatureCollection'; features: GeoJSONFeature[] }}
      >
        <CircleLayer
          id="layer-annotations-circle"
          paint={ANNOTATION_PIN_PAINT}
          onmouseenter={(e) => {
            if (mapInstance) mapInstance.getCanvas().style.cursor = 'pointer';
            const f = e.features?.[0];
            if (!f) return;
            const props = f.properties as AnnotationPinProperties | null;
            if (!props?.contentJson) return;
            try {
              const raw: unknown = JSON.parse(props.contentJson);
              const result = AnnotationObjectContentSchema.safeParse(raw);
              if (!result.success) return;
              hoveredAnnotation = {
                content: result.data,
                authorName: props.authorName,
                createdAt: props.createdAt,
                anchorType: props.anchorType ?? 'point',
                lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
              };
            } catch { /* invalid JSON */ }
          }}
          onmouseleave={() => {
            if (mapInstance) mapInstance.getCanvas().style.cursor = '';
            hoveredAnnotation = null;
          }}
          onclick={(e) => {
            // Don't interrupt active drawing tools
            const tool = selectionStore.activeTool;
            if (tool === 'point' || tool === 'line' || tool === 'polygon') return;

            const f = e.features?.[0];
            if (!f) return;

            const props = f.properties as AnnotationPinProperties | null;
            if (!props?.contentJson) return;

            let parsed: AnnotationObjectContent;
            try {
              const raw: unknown = JSON.parse(props.contentJson);
              const result = AnnotationObjectContentSchema.safeParse(raw);
              if (!result.success) return;
              parsed = result.data;
            } catch {
              return;
            }

            // Defer state writes — see handleFeatureClick comment for rationale.
            const lngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat };
            queueMicrotask(() => {
              hoveredAnnotation = null;
              selectedAnnotation = {
                content: parsed,
                authorName: props.authorName,
                createdAt: props.createdAt,
                anchorType: props.anchorType ?? 'point',
                lngLat,
              };
            });
          }}
        />
      </GeoJSONSource>
    {/if}

    <!-- Annotation region polygons — rendered below pins, above data layers -->
    {#if annotationRegions && annotationRegions.features.length > 0}
      <GeoJSONSource
        id="source-annotation-regions"
        data={annotationRegions as unknown as { type: 'FeatureCollection'; features: GeoJSONFeature[] }}
      >
        <FillLayer
          id="layer-annotation-regions-fill"
          paint={ANNOTATION_REGION_FILL_PAINT}
          onmouseenter={(e) => {
            if (mapInstance) mapInstance.getCanvas().style.cursor = 'pointer';
            const f = e.features?.[0];
            if (!f) return;
            const props = f.properties as AnnotationPinProperties | null;
            if (!props?.contentJson) return;
            try {
              const raw: unknown = JSON.parse(props.contentJson);
              const result = AnnotationObjectContentSchema.safeParse(raw);
              if (!result.success) return;
              hoveredAnnotation = {
                content: result.data,
                authorName: props.authorName,
                createdAt: props.createdAt,
                anchorType: props.anchorType ?? 'region',
                lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
              };
            } catch { /* invalid JSON */ }
          }}
          onmouseleave={() => {
            if (mapInstance) mapInstance.getCanvas().style.cursor = '';
            hoveredAnnotation = null;
          }}
          onclick={(e) => {
            const tool = selectionStore.activeTool;
            if (tool === 'point' || tool === 'line' || tool === 'polygon') return;

            const f = e.features?.[0];
            if (!f) return;

            const props = f.properties as AnnotationPinProperties | null;
            if (!props?.contentJson) return;

            let parsed: AnnotationObjectContent;
            try {
              const raw: unknown = JSON.parse(props.contentJson);
              const result = AnnotationObjectContentSchema.safeParse(raw);
              if (!result.success) return;
              parsed = result.data;
            } catch {
              return;
            }

            // Defer state writes — see handleFeatureClick comment for rationale.
            const lngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat };
            queueMicrotask(() => {
              hoveredAnnotation = null;
              selectedAnnotation = {
                content: parsed,
                authorName: props.authorName,
                createdAt: props.createdAt,
                anchorType: props.anchorType ?? 'region',
                lngLat,
              };
            });
          }}
        />
        <LineLayer
          id="layer-annotation-regions-outline"
          paint={ANNOTATION_REGION_LINE_PAINT}
        />
      </GeoJSONSource>
    {/if}

    <!-- Feature annotation badge indicators -->
    {#if badgeGeoJson.features.length > 0}
      <GeoJSONSource id="annotation-badges" data={badgeGeoJson}>
        <CircleLayer
          id="layer-annotation-badges"
          paint={BADGE_CIRCLE_PAINT}
          onmouseenter={() => {
            if (mapInstance) mapInstance.getCanvas().style.cursor = 'pointer';
          }}
          onmouseleave={() => {
            if (mapInstance) mapInstance.getCanvas().style.cursor = '';
          }}
          onclick={(e) => {
            const featureId = e.features?.[0]?.properties?.['featureId'];
            if (featureId) onbadgeclick?.(String(featureId));
          }}
        />
        <SymbolLayer
          id="layer-annotation-badge-labels"
          layout={BADGE_LABEL_LAYOUT}
          paint={BADGE_LABEL_PAINT}
        />
      </GeoJSONSource>
    {/if}

    <!-- Measurement annotation geometries (dashed lines / semi-transparent fills) -->
    {#if measurementAnnotations && measurementAnnotations.features.length > 0}
      <GeoJSONSource id="measurement-annotations" data={measurementAnnotations as unknown as { type: 'FeatureCollection'; features: GeoJSONFeature[] }}>
        <LineLayer
          id="measurement-annotations-line"
          filter={LINESTRING_FILTER}
          paint={MEASURE_LINE_PAINT}
          onmouseenter={() => {
            if (mapInstance) mapInstance.getCanvas().style.cursor = 'pointer';
          }}
          onmouseleave={() => {
            if (mapInstance) mapInstance.getCanvas().style.cursor = '';
          }}
        />
        <FillLayer
          id="measurement-annotations-fill"
          filter={POLYGON_FILTER}
          paint={MEASURE_FILL_PAINT}
        />
        <LineLayer
          id="measurement-annotations-outline"
          filter={POLYGON_FILTER}
          paint={MEASURE_LINE_PAINT}
        />
        <SymbolLayer
          id="measurement-annotations-label"
          layout={MEASURE_LABEL_LAYOUT}
          paint={MEASURE_LABEL_PAINT}
        />
      </GeoJSONSource>
    {/if}

    <!-- Hover tooltip — compact preview on mouseenter -->
    {#if hoveredAnnotation && !selectedAnnotation}
      <Popup
        lnglat={hoveredAnnotation.lngLat}
        closeButton={false}
        onclose={() => { hoveredAnnotation = null; }}
      >
        <AnnotationContent
          content={hoveredAnnotation.content}
          authorName={hoveredAnnotation.authorName}
          createdAt={hoveredAnnotation.createdAt}
          anchorType={hoveredAnnotation.anchorType}
          compact
        />
      </Popup>
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
          anchorType={selectedAnnotation.anchorType}
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
      {...(onregiondrawn !== undefined ? { onregiondrawn } : {})}
    />
  {/if}
</div>
