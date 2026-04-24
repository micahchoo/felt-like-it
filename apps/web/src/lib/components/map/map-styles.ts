/**
 * Pure functions for generating MapLibre paint/layout objects from layer style data.
 *
 * Extracted from MapCanvas.svelte so they can be unit-tested without
 * Svelte reactivity or a MapLibre instance.
 */
import type { SymbolLayerSpecification } from 'maplibre-gl';
import type { Layer } from '@felt-like-it/shared-types';
import { resolvePaintInterpolators } from '@felt-like-it/geo-engine';

// ── Paint defaults ─────────────────────────────────────────────────────
// MapLibre 5 crashes if paint: {} is passed — must always supply at least one explicit property.
export const PAINT_DEFAULTS: Record<'circle' | 'line' | 'fill', Record<string, unknown>> = {
  circle: { 'circle-radius': 6, 'circle-color': '#3b82f6', 'circle-opacity': 0.85, 'circle-stroke-width': 1.5, 'circle-stroke-color': '#ffffff' },
  line:   { 'line-color': '#6366f1', 'line-width': 2, 'line-opacity': 0.9 },
  fill:   { 'fill-color': '#22c55e', 'fill-opacity': 0.45, 'fill-outline-color': '#15803d' },
};

export type PaintType = 'circle' | 'line' | 'fill';

/**
 * Build a MapLibre paint object for a given layer and geometry type.
 *
 * Pure computation: extracts style.paint, resolves FSL interpolators,
 * filters to the requested paint type prefix, and falls back to PAINT_DEFAULTS.
 *
 * Does NOT apply highlight selection — call `applyHighlight` separately.
 */
export function getLayerPaint(layer: Layer, paintType: PaintType): Record<string, unknown> {
  const style = layer.style as Record<string, unknown> | null | undefined;
  const rawPaint = (style?.['paint'] as Record<string, unknown>) ?? {};

  // Resolve FSL zoom interpolators (e.g. { linear: [[10,2],[16,8]] }) -> MapLibre expressions
  const paint = resolvePaintInterpolators(rawPaint);

  // Only return paint properties relevant to this layer type — skip null/undefined
  // values that can leak from JSONB storage and crash MapLibre.
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(paint)) {
    if (key.startsWith(paintType + '-') && value != null) {
      filtered[key] = value;
    }
  }

  // Build a fresh result — never mutate PAINT_DEFAULTS (shared constant)
  return Object.keys(filtered).length > 0
    ? filtered
    : { ...(PAINT_DEFAULTS[paintType] as Record<string, unknown>) };
}

/** Opacity keys per paint type — used by hover-aware paint to add feature-state expressions.
 * Symbol layers are excluded: they render labels, not interactive data features.
 */
const OPACITY_KEYS: Record<PaintType, string> = {
  circle: 'circle-opacity',
  line: 'line-opacity',
  fill: 'fill-opacity',
};

const HOVER_OPACITY_BOOST = 0.15;

export function getHoverAwarePaint(layer: Layer, paintType: PaintType, highlightColor?: string): Record<string, unknown> {
  const basePaint = getLayerPaint(layer, paintType);
  const opacityKey = OPACITY_KEYS[paintType];
  const colorKey = `${paintType}-color`;

  const baseOpacity = (basePaint[opacityKey] as number) ??
    (PAINT_DEFAULTS[paintType] as Record<string, unknown>)[opacityKey] as number ??
    0.85;
  const hoverOpacity = Math.min(1, baseOpacity + HOVER_OPACITY_BOOST);

  const result: Record<string, unknown> = {
    ...basePaint,
    [opacityKey]: [
      'case',
      ['boolean', ['feature-state', 'hover'], false],
      hoverOpacity,
      baseOpacity,
    ],
  };

  if (highlightColor != null) {
    const baseColor = basePaint[colorKey] ?? (PAINT_DEFAULTS[paintType] as Record<string, unknown>)[colorKey];
    result[colorKey] = [
      'case',
      ['boolean', ['feature-state', 'selected'], false],
      highlightColor,
      baseColor,
    ];
  }

  return result;
}

/**
 * Apply highlight color for a selected feature.
 *
 * Wraps the primary color property in a MapLibre 'case' expression
 * so the selected feature renders in highlightColor.
 *
 * Returns a new paint object (never mutates the input).
 */
export function applyHighlight(
  paint: Record<string, unknown>,
  paintType: PaintType,
  highlightColor: string | null | undefined,
  selectedFeatureId: string | number | undefined,
): Record<string, unknown> {
  if (highlightColor == null || selectedFeatureId === undefined) return paint;

  const colorKey = `${paintType}-color`;
  const baseColor = paint[colorKey] ?? (PAINT_DEFAULTS[paintType] as Record<string, unknown>)[colorKey];
  return {
    ...paint,
    [colorKey]: ['case', ['==', ['id'], selectedFeatureId], highlightColor, baseColor],
  };
}

/**
 * Extract FSL-compatible label attribute from a layer's style.config.
 */
export function getLabelAttribute(layer: Layer): string | undefined {
  const style = layer.style as Record<string, unknown> | null | undefined;
  const config = style?.['config'] as Record<string, unknown> | undefined;
  return config?.['labelAttribute'] as string | undefined;
}

/**
 * FSL isClickable: when false, suppress all click interactions for this layer.
 * Defaults to true (undefined -> clickable).
 */
export function isLayerClickable(layer: Layer): boolean {
  const style = layer.style as Record<string, unknown> | null | undefined;
  return style?.['isClickable'] !== false;
}

/**
 * FSL isSandwiched: when true, FillLayer is inserted before the first basemap symbol
 * layer so polygon fills render beneath basemap labels.
 * Defaults to false (undefined -> not sandwiched).
 */
export function isLayerSandwiched(layer: Layer): boolean {
  const style = layer.style as Record<string, unknown> | null | undefined;
  return style?.['isSandwiched'] === true;
}

// TYPE_DEBT: getSymbolPaint/getSymbolLayout return object literals cast to MapLibre spec unions.
// The spec types are strict discriminated unions; our dynamic builders produce compatible shapes
// but TypeScript can't verify the union narrowing. Runtime-safe — MapLibre validates on use.

/**
 * Build the symbol (label) paint object for a layer.
 */
export function getSymbolPaint(layer: Layer): NonNullable<SymbolLayerSpecification['paint']> {
  const style = layer.style as Record<string, unknown> | null | undefined;
  const label = style?.['label'] as Record<string, unknown> | undefined;
  return {
    'text-color': (label?.['color'] as string | undefined) ?? '#222222',
    'text-halo-color': (label?.['haloColor'] as string | undefined) ?? '#ffffff',
    'text-halo-width': 1,
  } as unknown as NonNullable<SymbolLayerSpecification['paint']>;
}

/**
 * Build the symbol (label) layout object for a layer.
 */
export function getSymbolLayout(layer: Layer, labelAttr: string): NonNullable<SymbolLayerSpecification['layout']> {
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

/**
 * Build a MapLibre filter expression from a layer's FSL filters + showOther config.
 *
 * This is the "pure" portion of filtering — it handles:
 *   1. FSL style.filters (user-defined attribute filters)
 *   2. showOther:false guard (only show features in config.categories list)
 *
 * It does NOT include session-level UI filters (FiltersStore instance) — those
 * are ephemeral reactive state composed in MapCanvas.getLayerFilter at render time.
 *
 * @param fslFiltersToMapLibre - Injected converter (from @felt-like-it/geo-engine)
 *   so this module stays dependency-light for testing.
 */
export function getLayerFilter(
  layer: Layer,
  fslConverter: (filters: unknown[]) => unknown[] | null,
): unknown[] | undefined {
  const style = layer.style as Record<string, unknown> | null | undefined;
  const filters = style?.['filters'];
  const config = style?.['config'] as Record<string, unknown> | undefined;

  const parts: unknown[][] = [];

  // FSL style.filters -> MapLibre filter
  if (Array.isArray(filters) && filters.length > 0) {
    const fslResult = fslConverter(filters);
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
    parts.push(['in', ['get', field], ...cats]);
  }

  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return ['all', ...parts];
}

/**
 * Combined MapLibre filter for a vector tile layer.
 * Adds layer_id equality check on top of any user-defined filters.
 */
export function getVectorTileFilter(
  layer: Layer,
  fslConverter: (filters: unknown[]) => unknown[] | null,
): unknown[] {
  const baseFilter = getLayerFilter(layer, fslConverter);
  const layerIdFilter: unknown[] = ['==', ['get', 'layer_id'], layer.id];
  if (!baseFilter) return layerIdFilter;
  return ['all', layerIdFilter, baseFilter];
}

/**
 * Heatmap configuration extracted from a layer's style.config.
 * Returns null if the layer is not a heatmap layer.
 */
export interface HeatmapConfig {
  radiusPixels: number;
  intensity: number;
  weightAttribute?: string;
}

export function getHeatmapConfig(layer: Layer): HeatmapConfig | null {
  const style = layer.style as Record<string, unknown> | null | undefined;
  if (style?.['type'] !== 'heatmap') return null;

  const config = (style?.['config'] as Record<string, unknown>) ?? {};
  const weightAttr = config['heatmapWeightAttribute'] as string | undefined;
  return {
    radiusPixels: (config['heatmapRadius'] as number | undefined) ?? 30,
    intensity: (config['heatmapIntensity'] as number | undefined) ?? 1,
    ...(weightAttr !== undefined ? { weightAttribute: weightAttr } : {}),
  };
}
