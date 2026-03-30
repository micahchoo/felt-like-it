// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  PAINT_DEFAULTS,
  getLayerPaint,
  getHoverAwarePaint,
  applyHighlight,
  getLabelAttribute,
  isLayerClickable,
  isLayerSandwiched,
  getSymbolPaint,
  getSymbolLayout,
  getLayerFilter,
  getVectorTileFilter,
  getHeatmapConfig,
} from '../lib/components/map/map-styles.js';
import type { Layer } from '@felt-like-it/shared-types';

// ── Helpers ──────────────────────────────────────────────────────────────

/** Minimal layer stub — only the fields the style functions inspect. */
function makeLayer(overrides: Partial<Omit<Layer, 'style'>> & { style?: Record<string, unknown> | null }): Layer {
  const { style: styleOverride, ...rest } = overrides;
  // Merge a default type:'simple' into style so callers don't have to repeat it.
  // Null/undefined style is passed through (tests null-safety).
  const style = styleOverride === null || styleOverride === undefined
    ? styleOverride
    : { type: 'simple' as const, ...styleOverride };
  return {
    id: 'layer-1',
    mapId: 'map-1',
    name: 'Test Layer',
    type: 'point',
    visible: true,
    sortOrder: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    style: style ?? { type: 'simple' as const, paint: {} },
    ...rest,
  } as Layer;
}

/** No-op FSL converter — returns null (no FSL filters). */
const nullConverter = (_f: unknown[]): unknown[] | null => null;

/** Echo FSL converter — returns the input array as-is. */
const echoConverter = (f: unknown[]): unknown[] | null => f;

// ── PAINT_DEFAULTS ───────────────────────────────────────────────────────

describe('PAINT_DEFAULTS', () => {
  it('provides circle defaults with radius, color, opacity, and stroke', () => {
    expect(PAINT_DEFAULTS.circle).toHaveProperty('circle-radius');
    expect(PAINT_DEFAULTS.circle).toHaveProperty('circle-color');
    expect(PAINT_DEFAULTS.circle).toHaveProperty('circle-opacity');
    expect(PAINT_DEFAULTS.circle).toHaveProperty('circle-stroke-width');
  });

  it('provides line defaults with color, width, and opacity', () => {
    expect(PAINT_DEFAULTS.line).toHaveProperty('line-color');
    expect(PAINT_DEFAULTS.line).toHaveProperty('line-width');
    expect(PAINT_DEFAULTS.line).toHaveProperty('line-opacity');
  });

  it('provides fill defaults with color, opacity, and outline', () => {
    expect(PAINT_DEFAULTS.fill).toHaveProperty('fill-color');
    expect(PAINT_DEFAULTS.fill).toHaveProperty('fill-opacity');
    expect(PAINT_DEFAULTS.fill).toHaveProperty('fill-outline-color');
  });
});

// ── getLayerPaint ────────────────────────────────────────────────────────

describe('getLayerPaint', () => {
  it('returns defaults when style.paint is empty', () => {
    const layer = makeLayer({ style: { paint: {} } });
    const result = getLayerPaint(layer, 'circle');
    expect(result).toEqual(PAINT_DEFAULTS.circle);
  });

  it('does not mutate PAINT_DEFAULTS when returning defaults', () => {
    const before = { ...PAINT_DEFAULTS.circle };
    const layer = makeLayer({ style: { paint: {} } });
    const result = getLayerPaint(layer, 'circle');
    result['circle-radius'] = 999; // mutate the returned object
    expect(PAINT_DEFAULTS.circle).toEqual(before);
  });

  it('filters paint props to the requested type prefix', () => {
    const layer = makeLayer({
      style: {
        paint: {
          'circle-radius': 10,
          'circle-color': '#ff0000',
          'line-width': 5,
          'fill-color': '#00ff00',
        },
      },
    });

    const circle = getLayerPaint(layer, 'circle');
    expect(circle).toEqual({ 'circle-radius': 10, 'circle-color': '#ff0000' });
    expect(circle).not.toHaveProperty('line-width');
    expect(circle).not.toHaveProperty('fill-color');
  });

  it('strips null/undefined values from paint (JSONB leak protection)', () => {
    const layer = makeLayer({
      style: {
        paint: {
          'line-color': '#6366f1',
          'line-width': null,
          'line-opacity': undefined,
        },
      },
    });
    const result = getLayerPaint(layer, 'line');
    expect(result).toEqual({ 'line-color': '#6366f1' });
  });

  it('returns fill defaults when no fill-prefixed props exist', () => {
    const layer = makeLayer({
      style: { paint: { 'circle-radius': 8 } },
    });
    const result = getLayerPaint(layer, 'fill');
    expect(result).toEqual(PAINT_DEFAULTS.fill);
  });

  it('handles null style gracefully (returns defaults)', () => {
    const layer = makeLayer({ style: null as any });
    const result = getLayerPaint(layer, 'circle');
    expect(result).toEqual(PAINT_DEFAULTS.circle);
  });

  it('handles undefined style gracefully (returns defaults)', () => {
    const layer = makeLayer({ style: undefined as any });
    const result = getLayerPaint(layer, 'line');
    expect(result).toEqual(PAINT_DEFAULTS.line);
  });

  it('handles missing paint key in style (returns defaults)', () => {
    const layer = makeLayer({ style: { type: 'simple' } as any });
    const result = getLayerPaint(layer, 'fill');
    expect(result).toEqual(PAINT_DEFAULTS.fill);
  });
});

// ── applyHighlight ───────────────────────────────────────────────────────

describe('applyHighlight', () => {
  it('returns paint unchanged when highlightColor is null', () => {
    const paint = { 'circle-color': '#ff0000', 'circle-radius': 6 };
    const result = applyHighlight(paint, 'circle', null, 'feat-1');
    expect(result).toBe(paint); // same reference — no wrapping
  });

  it('returns paint unchanged when selectedFeatureId is undefined', () => {
    const paint = { 'line-color': '#ff0000' };
    const result = applyHighlight(paint, 'line', '#00ff00', undefined);
    expect(result).toBe(paint);
  });

  it('wraps color in a case expression for the selected feature', () => {
    const paint = { 'circle-color': '#3b82f6', 'circle-radius': 6 };
    const result = applyHighlight(paint, 'circle', '#ff0000', 'feat-42');
    expect(result['circle-color']).toEqual([
      'case', ['==', ['id'], 'feat-42'], '#ff0000', '#3b82f6',
    ]);
    // Non-color props preserved
    expect(result['circle-radius']).toBe(6);
  });

  it('uses PAINT_DEFAULTS fallback when color key is missing from paint', () => {
    const paint = { 'fill-opacity': 0.5 }; // no fill-color
    const result = applyHighlight(paint, 'fill', '#ff0000', 'feat-1');
    expect(result['fill-color']).toEqual([
      'case', ['==', ['id'], 'feat-1'], '#ff0000', PAINT_DEFAULTS.fill['fill-color'],
    ]);
  });

  it('does not mutate the input paint object', () => {
    const paint = { 'line-color': '#6366f1', 'line-width': 2 };
    const frozen = { ...paint };
    applyHighlight(paint, 'line', '#ff0000', 'feat-1');
    expect(paint).toEqual(frozen);
  });
});

// ── getLabelAttribute ────────────────────────────────────────────────────

describe('getLabelAttribute', () => {
  it('returns the labelAttribute from style.config', () => {
    const layer = makeLayer({
      style: { paint: {}, config: { labelAttribute: 'name' } },
    });
    expect(getLabelAttribute(layer)).toBe('name');
  });

  it('returns undefined when config is absent', () => {
    const layer = makeLayer({ style: { paint: {} } });
    expect(getLabelAttribute(layer)).toBeUndefined();
  });

  it('returns undefined when labelAttribute is not set', () => {
    const layer = makeLayer({
      style: { paint: {}, config: {} },
    });
    expect(getLabelAttribute(layer)).toBeUndefined();
  });

  it('returns undefined when style is null', () => {
    const layer = makeLayer({ style: null as any });
    expect(getLabelAttribute(layer)).toBeUndefined();
  });
});

// ── isLayerClickable ─────────────────────────────────────────────────────

describe('isLayerClickable', () => {
  it('defaults to true when isClickable is undefined', () => {
    const layer = makeLayer({ style: { paint: {} } });
    expect(isLayerClickable(layer)).toBe(true);
  });

  it('returns false when isClickable is explicitly false', () => {
    const layer = makeLayer({ style: { paint: {}, isClickable: false } });
    expect(isLayerClickable(layer)).toBe(false);
  });

  it('returns true when isClickable is explicitly true', () => {
    const layer = makeLayer({ style: { paint: {}, isClickable: true } });
    expect(isLayerClickable(layer)).toBe(true);
  });

  it('returns true when style is null', () => {
    const layer = makeLayer({ style: null as any });
    expect(isLayerClickable(layer)).toBe(true);
  });
});

// ── isLayerSandwiched ────────────────────────────────────────────────────

describe('isLayerSandwiched', () => {
  it('defaults to false when isSandwiched is undefined', () => {
    const layer = makeLayer({ style: { paint: {} } });
    expect(isLayerSandwiched(layer)).toBe(false);
  });

  it('returns true when isSandwiched is explicitly true', () => {
    const layer = makeLayer({ style: { paint: {}, isSandwiched: true } });
    expect(isLayerSandwiched(layer)).toBe(true);
  });

  it('returns false when style is null', () => {
    const layer = makeLayer({ style: null as any });
    expect(isLayerSandwiched(layer)).toBe(false);
  });
});

// ── getSymbolPaint ───────────────────────────────────────────────────────

describe('getSymbolPaint', () => {
  it('returns default label colors when no label config exists', () => {
    const layer = makeLayer({ style: { paint: {} } });
    const result = getSymbolPaint(layer) as Record<string, unknown>;
    expect(result['text-color']).toBe('#222222');
    expect(result['text-halo-color']).toBe('#ffffff');
    expect(result['text-halo-width']).toBe(1);
  });

  it('uses custom label colors from style.label', () => {
    const layer = makeLayer({
      style: { paint: {}, label: { color: '#ff0000', haloColor: '#000000' } },
    });
    const result = getSymbolPaint(layer) as Record<string, unknown>;
    expect(result['text-color']).toBe('#ff0000');
    expect(result['text-halo-color']).toBe('#000000');
  });

  it('handles null style gracefully', () => {
    const layer = makeLayer({ style: null as any });
    const result = getSymbolPaint(layer) as Record<string, unknown>;
    expect(result['text-color']).toBe('#222222');
  });
});

// ── getSymbolLayout ──────────────────────────────────────────────────────

describe('getSymbolLayout', () => {
  it('builds a text-field expression from the label attribute', () => {
    const layer = makeLayer({ style: { paint: {} } });
    const result = getSymbolLayout(layer, 'name') as Record<string, unknown>;
    expect(result['text-field']).toEqual(['get', 'name']);
    expect(result['text-size']).toBe(12); // default
    expect(result['text-anchor']).toBe('top');
  });

  it('uses custom fontSize from style.label', () => {
    const layer = makeLayer({
      style: { paint: {}, label: { fontSize: 16 } },
    });
    const result = getSymbolLayout(layer, 'title') as Record<string, unknown>;
    expect(result['text-size']).toBe(16);
    expect(result['text-field']).toEqual(['get', 'title']);
  });

  it('handles null style gracefully', () => {
    const layer = makeLayer({ style: null as any });
    const result = getSymbolLayout(layer, 'id') as Record<string, unknown>;
    expect(result['text-field']).toEqual(['get', 'id']);
    expect(result['text-size']).toBe(12);
  });
});

// ── getLayerFilter ───────────────────────────────────────────────────────

describe('getLayerFilter', () => {
  it('returns undefined when no filters or categories exist', () => {
    const layer = makeLayer({ style: { paint: {} } });
    expect(getLayerFilter(layer, nullConverter)).toBeUndefined();
  });

  it('returns the FSL filter result when filters are present', () => {
    const layer = makeLayer({
      style: { paint: {}, filters: [['name', 'eq', 'test']] },
    });
    const mockResult = ['==', ['get', 'name'], 'test'];
    const converter = (_f: unknown[]) => mockResult;
    expect(getLayerFilter(layer, converter)).toEqual(mockResult);
  });

  it('returns showOther category filter when showOther is false', () => {
    const layer = makeLayer({
      style: {
        paint: {},
        config: {
          showOther: false,
          categoricalAttribute: 'type',
          categories: ['park', 'school'],
        },
      },
    });
    const result = getLayerFilter(layer, nullConverter);
    expect(result).toEqual(['in', ['get', 'type'], 'park', 'school']);
  });

  it('combines FSL filter and showOther into an "all" expression', () => {
    const fslResult = ['==', ['get', 'status'], 'active'];
    const converter = (_f: unknown[]) => fslResult;
    const layer = makeLayer({
      style: {
        paint: {},
        filters: [['status', 'eq', 'active']],
        config: {
          showOther: false,
          categoricalAttribute: 'type',
          categories: ['park'],
        },
      },
    });
    const result = getLayerFilter(layer, converter);
    expect(result).toEqual([
      'all',
      fslResult,
      ['in', ['get', 'type'], 'park'],
    ]);
  });

  it('ignores empty filters array', () => {
    const layer = makeLayer({ style: { paint: {}, filters: [] } });
    expect(getLayerFilter(layer, echoConverter)).toBeUndefined();
  });

  it('ignores showOther:false when categories is empty', () => {
    const layer = makeLayer({
      style: {
        paint: {},
        config: {
          showOther: false,
          categoricalAttribute: 'type',
          categories: [],
        },
      },
    });
    expect(getLayerFilter(layer, nullConverter)).toBeUndefined();
  });

  it('ignores showOther:false when categoricalAttribute is missing', () => {
    const layer = makeLayer({
      style: {
        paint: {},
        config: { showOther: false, categories: ['park'] },
      },
    });
    expect(getLayerFilter(layer, nullConverter)).toBeUndefined();
  });

  it('handles null style gracefully', () => {
    const layer = makeLayer({ style: null as any });
    expect(getLayerFilter(layer, nullConverter)).toBeUndefined();
  });
});

// ── getVectorTileFilter ──────────────────────────────────────────────────

describe('getVectorTileFilter', () => {
  it('returns layer_id filter when no base filter exists', () => {
    const layer = makeLayer({ id: 'abc-123', style: { paint: {} } });
    const result = getVectorTileFilter(layer, nullConverter);
    expect(result).toEqual(['==', ['get', 'layer_id'], 'abc-123']);
  });

  it('combines layer_id filter with base filter', () => {
    const fslResult = ['==', ['get', 'name'], 'test'];
    const converter = (_f: unknown[]) => fslResult;
    const layer = makeLayer({
      id: 'abc-123',
      style: { paint: {}, filters: [['name', 'eq', 'test']] },
    });
    const result = getVectorTileFilter(layer, converter);
    expect(result).toEqual([
      'all',
      ['==', ['get', 'layer_id'], 'abc-123'],
      fslResult,
    ]);
  });
});

// ── getHeatmapConfig ─────────────────────────────────────────────────────

describe('getHeatmapConfig', () => {
  it('returns null for non-heatmap layers', () => {
    const layer = makeLayer({ style: { paint: {}, type: 'simple' } });
    expect(getHeatmapConfig(layer)).toBeNull();
  });

  it('returns null when style type is undefined', () => {
    const layer = makeLayer({ style: { paint: {} } });
    expect(getHeatmapConfig(layer)).toBeNull();
  });

  it('returns defaults for a heatmap layer with no config', () => {
    const layer = makeLayer({ style: { paint: {}, type: 'heatmap' } });
    const result = getHeatmapConfig(layer);
    expect(result).toEqual({ radiusPixels: 30, intensity: 1 });
    expect(result).not.toHaveProperty('weightAttribute');
  });

  it('uses custom heatmap config values', () => {
    const layer = makeLayer({
      style: {
        paint: {},
        type: 'heatmap',
        config: { heatmapRadius: 50, heatmapIntensity: 2.5, heatmapWeightAttribute: 'population' },
      },
    });
    const result = getHeatmapConfig(layer);
    expect(result).toEqual({
      radiusPixels: 50,
      intensity: 2.5,
      weightAttribute: 'population',
    });
  });

  it('handles null style gracefully', () => {
    const layer = makeLayer({ style: null as any });
    expect(getHeatmapConfig(layer)).toBeNull();
  });

  it('omits weightAttribute key when not defined (exactOptionalPropertyTypes safe)', () => {
    const layer = makeLayer({
      style: {
        paint: {},
        type: 'heatmap',
        config: { heatmapRadius: 40 },
      },
    });
    const result = getHeatmapConfig(layer)!;
    expect(Object.keys(result)).not.toContain('weightAttribute');
  });
});

// ── getHoverAwarePaint ──────────────────────────────────────────────────

describe('getHoverAwarePaint', () => {
  it('fills, circles, and lines all get feature-state hover opacity boost', () => {
    const types = ['fill', 'circle', 'line'] as const;
    for (const paintType of types) {
      const layer = makeLayer({ style: { paint: {} } });
      const result = getHoverAwarePaint(layer, paintType);
      const opacityKey = `${paintType}-opacity`;
      expect(Array.isArray(result[opacityKey])).toBe(true);
      const expr = result[opacityKey] as unknown[];
      expect(expr[0]).toBe('case');
      expect(expr[1]).toEqual(['boolean', ['feature-state', 'hover'], false]);
    }
  });

  it('hover opacity is higher than base opacity', () => {
    const layer = makeLayer({ style: { paint: { 'circle-opacity': 0.7 } } });
    const result = getHoverAwarePaint(layer, 'circle');
    const expr = result['circle-opacity'] as unknown[];
    const hoverOpacity = expr[2] as number;
    const baseOpacity = expr[3] as number;
    expect(hoverOpacity).toBeGreaterThan(baseOpacity);
    expect(baseOpacity).toBe(0.7);
    expect(hoverOpacity).toBeCloseTo(0.85);
  });

  it('clamps hover opacity at 1.0 when base is already high', () => {
    const layer = makeLayer({ style: { paint: { 'fill-opacity': 0.95 } } });
    const result = getHoverAwarePaint(layer, 'fill');
    const expr = result['fill-opacity'] as unknown[];
    const hoverOpacity = expr[2] as number;
    expect(hoverOpacity).toBe(1);
  });

  it('preserves all other paint properties', () => {
    const layer = makeLayer({
      style: {
        paint: {
          'circle-radius': 10,
          'circle-color': '#ff0000',
          'circle-opacity': 0.8,
          'circle-stroke-width': 2,
        },
      },
    });
    const result = getHoverAwarePaint(layer, 'circle');
    expect(result['circle-radius']).toBe(10);
    expect(result['circle-color']).toBe('#ff0000');
    expect(result['circle-stroke-width']).toBe(2);
    // opacity is an expression, not a plain number
    expect(Array.isArray(result['circle-opacity'])).toBe(true);
  });

  it('handles null style gracefully', () => {
    const layer = makeLayer({ style: null as any });
    const result = getHoverAwarePaint(layer, 'line');
    // Should fall back to defaults and still produce a hover expression
    const expr = result['line-opacity'] as unknown[];
    expect(expr[0]).toBe('case');
    expect(expr[3]).toBe(PAINT_DEFAULTS.line['line-opacity']);
  });
});
