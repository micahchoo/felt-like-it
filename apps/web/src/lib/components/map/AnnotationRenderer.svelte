<script lang="ts">
  /* global queueMicrotask */
  import { GeoJSONSource, CircleLayer, LineLayer, FillLayer, SymbolLayer, Popup } from 'svelte-maplibre-gl';
  import { mapStore } from '$lib/stores/map.svelte.js';
  import { getMapEditorState } from '$lib/stores/map-editor-state.svelte.js';
  import { AnnotationObjectContentSchema } from '@felt-like-it/shared-types';
  import type { AnnotationObjectContent } from '@felt-like-it/shared-types';
  import type { GeoJSONFeature } from '@felt-like-it/shared-types';
  import AnnotationContent from '$lib/components/annotations/AnnotationContent.svelte';
  import type { Feature, Point } from 'geojson';

  // ── Annotation type interfaces ──────────────────────────────────────────────
  // Defined locally; will be the single source of truth once MapCanvas is slimmed (Task 4).

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

  interface AnnotationPath {
    type: 'Feature';
    id: string;
    geometry: { type: 'LineString'; coordinates: number[][] };
    properties: AnnotationPinProperties;
  }

  export interface AnnotationPathCollection {
    type: 'FeatureCollection';
    features: AnnotationPath[];
  }

  /** State for the annotation popup — set when an annotation pin/region is clicked. */
  interface SelectedAnnotationPopup {
    content: AnnotationObjectContent;
    authorName: string;
    createdAt: string;
    anchorType: string;
    lngLat: { lng: number; lat: number };
  }

  // ── Props ──────────────────────────────────────────────────────────────────

  interface Props {
    annotationPins?: AnnotationPinCollection | undefined;
    annotationRegions?: AnnotationRegionCollection | undefined;
    annotationPaths?: AnnotationPathCollection | undefined;
    badgeGeoJson: { type: 'FeatureCollection'; features: Feature<Point>[] };
    measurementAnnotations?: { type: 'FeatureCollection'; features: { type: 'Feature'; geometry: unknown; properties: Record<string, unknown> }[] } | undefined;
    onbadgeclick?: ((_featureId: string) => void) | undefined;
  }

  let { annotationPins, annotationRegions, annotationPaths, badgeGeoJson, measurementAnnotations, onbadgeclick }: Props = $props();

  // ── Context ────────────────────────────────────────────────────────────────

  const editorState = getMapEditorState();

  // ── Stable paint/layout constants ──────────────────────────────────────────
  // New object references per render cause infinite loops in svelte-maplibre-gl.
  //
  // Per-annotation style: feature properties (strokeColor, strokeWidth, …) are
  // folded in at derive-time by `annotation-geo.svelte.ts#styleProps`. Paint
  // expressions below use `['coalesce', ['get', 'foo'], DEFAULT]` so annotations
  // without a style render with the original hard-coded defaults.
  // `line-dasharray` is NOT data-driven in MapLibre GL JS — per-feature dash
  // styling (Felt-parity plan Task 3.3) is a known gap; only solid lines vary
  // per-feature. See seeds for follow-up.

  const ANNOTATION_PIN_PAINT = {
    'circle-radius': 10,
    'circle-color': ['coalesce', ['get', 'fillColor'], '#f59e0b'],
    'circle-stroke-width': ['coalesce', ['get', 'strokeWidth'], 2],
    'circle-stroke-color': ['coalesce', ['get', 'strokeColor'], '#ffffff'],
    'circle-opacity': ['coalesce', ['get', 'fillOpacity'], 0.92],
    'circle-stroke-opacity': ['coalesce', ['get', 'strokeOpacity'], 1],
  } as any;
  const ANNOTATION_REGION_FILL_PAINT = {
    'fill-color': ['coalesce', ['get', 'fillColor'], '#3b82f6'],
    'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.15],
  } as any;
  const ANNOTATION_REGION_LINE_PAINT = {
    'line-color': ['coalesce', ['get', 'strokeColor'], '#3b82f6'],
    'line-width': ['coalesce', ['get', 'strokeWidth'], 2],
    'line-opacity': ['coalesce', ['get', 'strokeOpacity'], 0.6],
  } as any;
  // Freely-drawn path anchors. Default colour matches the region stroke so a
  // user's palette stays coherent across geometries. Same dash limitation applies.
  const ANNOTATION_PATH_PAINT = {
    'line-color': ['coalesce', ['get', 'strokeColor'], '#3b82f6'],
    'line-width': ['coalesce', ['get', 'strokeWidth'], 2],
    'line-opacity': ['coalesce', ['get', 'strokeOpacity'], 0.85],
  } as any;
  const BADGE_CIRCLE_PAINT = {
    'circle-radius': 8, 'circle-color': '#f59e0b',
    'circle-stroke-width': 2, 'circle-stroke-color': '#ffffff',
  };
  // TYPE_DEBT: MapLibre layout/filter specs expect ExpressionSpecification but our literal
  // arrays are compatible at runtime — applies to the `as any` casts on BADGE_LABEL_LAYOUT,
  // MEASURE_LABEL_LAYOUT, LINESTRING_FILTER, and POLYGON_FILTER below.
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

  // ── Annotation state ───────────────────────────────────────────────────────

  let selectedAnnotation = $state<SelectedAnnotationPopup | null>(null);

  /** Lightweight hover tooltip — shown on mouseenter, hidden on mouseleave. */
  let hoveredAnnotation = $state<SelectedAnnotationPopup | null>(null);

  // ── Mobile tap deduplication ───────────────────────────────────────────────
  // Guard against duplicate click events on mobile. Touch interactions can fire
  // the same logical tap across multiple overlapping sublayers (Fill + Line +
  // Circle) because MapLibre's touch tolerance matches the feature in more than
  // one layer. We deduplicate by ignoring clicks within 300ms of the last
  // processed one. See: felt-like-it-39b2.
  let _lastClickTs = 0;
  const CLICK_DEDUP_MS = 300;
</script>

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
        const map = mapStore.mapInstance;
        if (map) map.getCanvas().style.cursor = 'pointer';
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
        const map = mapStore.mapInstance;
        if (map) map.getCanvas().style.cursor = '';
        hoveredAnnotation = null;
      }}
      onclick={(e) => {
        // Don't interrupt active drawing tools
        const tool = editorState.activeTool;
        if (tool === 'point' || tool === 'line' || tool === 'polygon') return;

        // Deduplicate mobile taps — shared guard with handleFeatureClick (felt-like-it-39b2).
        const now = performance.now();
        if (now - _lastClickTs < CLICK_DEDUP_MS) return;
        _lastClickTs = now;

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

        // Defer state writes — click handlers during Svelte 5 effect flush can
        // exceed the 1000-iteration depth limit; defer with queueMicrotask().
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
        const map = mapStore.mapInstance;
        if (map) map.getCanvas().style.cursor = 'pointer';
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
        const map = mapStore.mapInstance;
        if (map) map.getCanvas().style.cursor = '';
        hoveredAnnotation = null;
      }}
      onclick={(e) => {
        const tool = editorState.activeTool;
        if (tool === 'point' || tool === 'line' || tool === 'polygon') return;

        // Deduplicate mobile taps — shared guard with handleFeatureClick (felt-like-it-39b2).
        const now = performance.now();
        if (now - _lastClickTs < CLICK_DEDUP_MS) return;
        _lastClickTs = now;

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

        // Defer state writes — see annotation pin click for rationale.
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

<!-- Annotation paths — line-anchored annotations; rendered below pins, above data layers -->
{#if annotationPaths && annotationPaths.features.length > 0}
  <GeoJSONSource
    id="source-annotation-paths"
    data={annotationPaths as unknown as { type: 'FeatureCollection'; features: GeoJSONFeature[] }}
  >
    <LineLayer
      id="layer-annotation-paths"
      paint={ANNOTATION_PATH_PAINT}
      onmouseenter={(e) => {
        const map = mapStore.mapInstance;
        if (map) map.getCanvas().style.cursor = 'pointer';
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
            anchorType: props.anchorType ?? 'path',
            lngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
          };
        } catch { /* invalid JSON */ }
      }}
      onmouseleave={() => {
        const map = mapStore.mapInstance;
        if (map) map.getCanvas().style.cursor = '';
        hoveredAnnotation = null;
      }}
      onclick={(e) => {
        const tool = editorState.activeTool;
        if (tool === 'point' || tool === 'line' || tool === 'polygon') return;

        const now = performance.now();
        if (now - _lastClickTs < CLICK_DEDUP_MS) return;
        _lastClickTs = now;

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

        const lngLat = { lng: e.lngLat.lng, lat: e.lngLat.lat };
        queueMicrotask(() => {
          hoveredAnnotation = null;
          selectedAnnotation = {
            content: parsed,
            authorName: props.authorName,
            createdAt: props.createdAt,
            anchorType: props.anchorType ?? 'path',
            lngLat,
          };
        });
      }}
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
        const map = mapStore.mapInstance;
        if (map) map.getCanvas().style.cursor = 'pointer';
      }}
      onmouseleave={() => {
        const map = mapStore.mapInstance;
        if (map) map.getCanvas().style.cursor = '';
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
        const map = mapStore.mapInstance;
        if (map) map.getCanvas().style.cursor = 'pointer';
      }}
      onmouseleave={() => {
        const map = mapStore.mapInstance;
        if (map) map.getCanvas().style.cursor = '';
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

<!-- Annotation popup — shown on pin click; independent of editorState -->
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
