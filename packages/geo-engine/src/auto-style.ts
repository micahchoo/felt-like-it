import type { LayerStyle, LayerType, LegendEntry } from '@felt-like-it/shared-types';
import {
  isCategoricalColumn,
  isNumericColumn,
  getUniqueValues,
} from './detect.js';
import { getColorRamp, type ColorRampName } from './color-ramps.js';
import { equalIntervalBreaks, quantileBreaks, type ClassificationMethod } from './classify.js';

// Default color palettes
const CATEGORICAL_COLORS = [
  '#e41a1c',
  '#377eb8',
  '#4daf4a',
  '#984ea3',
  '#ff7f00',
  '#a65628',
  '#f781bf',
  '#999999',
  '#8dd3c7',
  '#bebada',
  '#fb8072',
  '#80b1d3',
];

// Default sequential ramp for auto-graduated styling (5 classes, Blues)
const GRADUATED_COLORS = getColorRamp('Blues', 5);

const DEFAULT_POINT_COLOR = '#3b82f6';
const DEFAULT_LINE_COLOR = '#6366f1';
const DEFAULT_POLYGON_FILL = '#22c55e';
const DEFAULT_POLYGON_STROKE = '#15803d';

/**
 * Generate an auto-style for a layer based on its geometry type and feature properties.
 */
export function generateAutoStyle(
  layerType: LayerType,
  features: Array<{ properties: Record<string, unknown> }>,
  preferredField?: string
): LayerStyle {
  // Pick the best field for data-driven styling
  const field = preferredField ?? pickBestField(features);

  if (field !== null) {
    const values = features
      .map((f) => f.properties[field])
      .filter((v) => v !== null && v !== undefined);

    if (isCategoricalColumn(values)) {
      return generateCategoricalStyle(layerType, field, values);
    }

    if (isNumericColumn(values)) {
      return generateGraduatedStyle(layerType, field, values as number[]);
    }
  }

  return generateSimpleStyle(layerType);
}

/** Pick the best field for auto-styling (categorical or numeric) */
function pickBestField(
  features: Array<{ properties: Record<string, unknown> }>
): string | null {
  if (features.length === 0) return null;

  const firstFeature = features[0];
  if (!firstFeature) return null;

  const keys = Object.keys(firstFeature.properties ?? {});
  if (keys.length === 0) return null;

  // Skip common ID and timestamp fields
  const skipPatterns = /^(id|uuid|fid|gid|objectid|created_at|updated_at|timestamp|the_geom)$/i;

  for (const key of keys) {
    if (skipPatterns.test(key)) continue;
    const values = features
      .map((f) => f.properties[key])
      .filter((v) => v !== null && v !== undefined);
    if (isCategoricalColumn(values) || isNumericColumn(values)) {
      return key;
    }
  }

  return null;
}

function generateSimpleStyle(layerType: LayerType): LayerStyle {
  switch (layerType) {
    case 'point':
    case 'mixed':
      return {
        type: 'simple',
        paint: {
          'circle-radius': 6,
          'circle-color': DEFAULT_POINT_COLOR,
          'circle-opacity': 0.85,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      };
    case 'line':
      return {
        type: 'simple',
        paint: {
          'line-color': DEFAULT_LINE_COLOR,
          'line-width': 2,
          'line-opacity': 0.9,
        },
      };
    case 'polygon':
      return {
        type: 'simple',
        paint: {
          'fill-color': DEFAULT_POLYGON_FILL,
          'fill-opacity': 0.45,
          'fill-outline-color': DEFAULT_POLYGON_STROKE,
        },
      };
  }
}

function generateCategoricalStyle(
  layerType: LayerType,
  field: string,
  values: unknown[]
): LayerStyle {
  const uniqueValues = getUniqueValues(values);
  const colorMap: Array<[unknown, string]> = uniqueValues.map((v, i) => [
    v,
    CATEGORICAL_COLORS[i % CATEGORICAL_COLORS.length] ?? DEFAULT_POINT_COLOR,
  ]);

  const legend: LegendEntry[] = colorMap.map(([value, color]) => ({
    label: String(value),
    color,
    value: String(value),
  }));

  // Build MapLibre expression: ["match", ["get", field], val1, color1, val2, color2, ..., fallback]
  const matchExpression: unknown[] = ['match', ['get', field]];
  for (const [val, color] of colorMap) {
    matchExpression.push(val, color);
  }
  matchExpression.push(DEFAULT_POINT_COLOR); // fallback

  const categories = uniqueValues.map(String);
  const config = { categoricalAttribute: field, categories };

  switch (layerType) {
    case 'point':
    case 'mixed':
      return {
        type: 'categorical',
        config,
        colorField: field,
        paint: {
          'circle-radius': 6,
          'circle-color': matchExpression,
          'circle-opacity': 0.85,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
        legend,
      };
    case 'line':
      return {
        type: 'categorical',
        config,
        colorField: field,
        paint: {
          'line-color': matchExpression,
          'line-width': 2,
          'line-opacity': 0.9,
        },
        legend,
      };
    case 'polygon':
      return {
        type: 'categorical',
        config,
        colorField: field,
        paint: {
          'fill-color': matchExpression,
          'fill-opacity': 0.45,
          'fill-outline-color': '#ffffff',
        },
        legend,
      };
  }
}

function generateGraduatedStyle(
  layerType: LayerType,
  field: string,
  values: number[]
): LayerStyle {
  // Delegate to generateChoroplethStyle with defaults (Blues, 5 classes, equal_interval)
  return generateChoroplethStyle(layerType, field, values, 'Blues', 5, 'equal_interval');
}

// ─── Formatting helper ────────────────────────────────────────────────────────

function formatBreakLabel(lo: number | undefined, hi: number | undefined): string {
  const fmt = (n: number | undefined): string =>
    n === undefined ? '…' : Number.isInteger(n) ? String(n) : n.toFixed(2);
  return `${fmt(lo)} – ${fmt(hi)}`;
}

// ─── Public choropleth API ────────────────────────────────────────────────────

/**
 * Generate a choropleth (numeric graduated) style for a polygon/point/line layer.
 *
 * @param layerType  - geometry type of the layer
 * @param field      - feature property to color by (must be numeric)
 * @param values     - array of raw numeric values from the layer's features
 * @param rampName   - ColorBrewer ramp name (default: 'Blues')
 * @param nClasses   - number of color classes, 2–9 (default: 5)
 * @param method     - classification method (default: 'quantile')
 */
export function generateChoroplethStyle(
  layerType: LayerType,
  field: string,
  values: number[],
  rampName: ColorRampName = 'Blues',
  nClasses: number = 5,
  method: ClassificationMethod = 'quantile'
): LayerStyle {
  const nums = values.map(Number).filter((v) => !isNaN(v));
  if (nums.length === 0) return generateSimpleStyle(layerType);

  const colors = getColorRamp(rampName, nClasses);
  const min = Math.min(...nums);
  const max = Math.max(...nums);

  // Compute internal breakpoints using chosen classification method
  const internalBreaks =
    method === 'quantile'
      ? quantileBreaks(nums, nClasses)
      : equalIntervalBreaks(nums, nClasses);

  // MapLibre step expression: base color (< first break) then [break, color] pairs
  const stepExpression: unknown[] = ['step', ['get', field], colors[0] ?? '#eff3ff'];
  for (let i = 0; i < internalBreaks.length; i++) {
    stepExpression.push(internalBreaks[i], colors[i + 1] ?? colors[colors.length - 1] ?? '#08519c');
  }

  // Legend: one entry per color class; label shows the data range
  const breakpoints = [min, ...internalBreaks, max];
  const legend: LegendEntry[] = colors.map((color, i) => ({
    label: formatBreakLabel(breakpoints[i], breakpoints[i + 1]),
    color,
  }));

  // steps[]: [threshold, color] pairs that mirror the step expression (for re-hydration)
  const steps: [number, string][] = [min, ...internalBreaks].map((b, i) => [b, colors[i] ?? '#eff3ff']);

  const config = { numericAttribute: field, steps, classificationMethod: method, nClasses, colorRampName: rampName };

  switch (layerType) {
    case 'point':
    case 'mixed':
      return {
        type: 'numeric',
        config,
        colorField: field,
        colorRamp: colors,
        paint: {
          'circle-radius': 6,
          'circle-color': stepExpression,
          'circle-opacity': 0.85,
          'circle-stroke-width': 1,
          'circle-stroke-color': '#ffffff',
        },
        legend,
      };
    case 'line':
      return {
        type: 'numeric',
        config,
        colorField: field,
        colorRamp: colors,
        paint: {
          'line-color': stepExpression,
          'line-width': 2,
          'line-opacity': 0.9,
        },
        legend,
      };
    case 'polygon':
      return {
        type: 'numeric',
        config,
        colorField: field,
        colorRamp: colors,
        paint: {
          'fill-color': stepExpression,
          'fill-opacity': 0.55,
          'fill-outline-color': '#ffffff',
        },
        legend,
      };
  }
}
