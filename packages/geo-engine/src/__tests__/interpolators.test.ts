import { describe, it, expect } from 'vitest';
import {
  isFslInterpolator,
  fslInterpolatorToMapLibre,
  resolvePaintInterpolators,
} from '../interpolators.js';

describe('isFslInterpolator', () => {
  it('detects linear interpolator', () => {
    expect(isFslInterpolator({ linear: [[10, 2], [16, 8]] })).toBe(true);
  });

  it('detects step interpolator', () => {
    expect(isFslInterpolator({ step: [2, [[14, 4], [16, 8]]] })).toBe(true);
  });

  it('detects exp interpolator', () => {
    expect(isFslInterpolator({ exp: [2, [[10, 2], [16, 8]]] })).toBe(true);
  });

  it('detects cubicbezier interpolator', () => {
    expect(isFslInterpolator({ cubicbezier: [0.42, 0, 1, 1, [[10, 2], [16, 8]]] })).toBe(true);
  });

  it('returns false for plain number', () => {
    expect(isFslInterpolator(6)).toBe(false);
  });

  it('returns false for string', () => {
    expect(isFslInterpolator('#ff0000')).toBe(false);
  });

  it('returns false for array (MapLibre expression)', () => {
    expect(isFslInterpolator(['get', 'name'])).toBe(false);
  });

  it('returns false for null', () => {
    expect(isFslInterpolator(null)).toBe(false);
  });

  it('returns false for object without interpolator key', () => {
    expect(isFslInterpolator({ color: '#ff0000' })).toBe(false);
  });
});

describe('fslInterpolatorToMapLibre', () => {
  describe('linear interpolator', () => {
    it('converts linear stops to MapLibre interpolate expression', () => {
      const result = fslInterpolatorToMapLibre({
        linear: [
          [10, 2],
          [16, 8],
        ],
      });
      expect(result).toEqual(['interpolate', ['linear'], ['zoom'], 10, 2, 16, 8]);
    });

    it('handles more than 2 stops', () => {
      const result = fslInterpolatorToMapLibre({
        linear: [
          [8, 1],
          [12, 4],
          [16, 12],
        ],
      });
      expect(result).toEqual(['interpolate', ['linear'], ['zoom'], 8, 1, 12, 4, 16, 12]);
    });

    it('throws for fewer than 2 stops', () => {
      expect(() =>
        fslInterpolatorToMapLibre({ linear: [[10, 2]] })
      ).toThrow('at least 2 stops');
    });

    it('throws for non-array stops', () => {
      expect(() => fslInterpolatorToMapLibre({ linear: 'invalid' })).toThrow();
    });
  });

  describe('step interpolator', () => {
    it('converts step to MapLibre step expression', () => {
      const result = fslInterpolatorToMapLibre({
        step: [2, [[14, 4], [16, 8]]],
      });
      expect(result).toEqual(['step', ['zoom'], 2, 14, 4, 16, 8]);
    });

    it('handles string base value', () => {
      const result = fslInterpolatorToMapLibre({
        step: ['#eff3ff', [[12, '#6baed6'], [16, '#08519c']]],
      });
      expect(result).toEqual(['step', ['zoom'], '#eff3ff', 12, '#6baed6', 16, '#08519c']);
    });

    it('throws for wrong structure (not [base, stops] pair)', () => {
      expect(() => fslInterpolatorToMapLibre({ step: [2] })).toThrow();
    });
  });

  describe('exp interpolator', () => {
    it('converts exp to MapLibre exponential interpolate', () => {
      const result = fslInterpolatorToMapLibre({
        exp: [2, [[10, 2], [16, 8]]],
      });
      expect(result).toEqual(['interpolate', ['exponential', 2], ['zoom'], 10, 2, 16, 8]);
    });

    it('handles fractional base', () => {
      const result = fslInterpolatorToMapLibre({
        exp: [1.5, [[8, 1], [14, 16]]],
      });
      expect(result).toEqual(['interpolate', ['exponential', 1.5], ['zoom'], 8, 1, 14, 16]);
    });

    it('throws when base is not a number', () => {
      expect(() =>
        fslInterpolatorToMapLibre({ exp: ['notANumber', [[10, 2], [16, 8]]] })
      ).toThrow('base must be a number');
    });

    it('throws for fewer than 2 stops', () => {
      expect(() =>
        fslInterpolatorToMapLibre({ exp: [2, [[10, 2]]] })
      ).toThrow('at least 2 stops');
    });
  });

  describe('cubicbezier interpolator', () => {
    it('converts cubicbezier to MapLibre cubic-bezier interpolate', () => {
      const result = fslInterpolatorToMapLibre({
        cubicbezier: [0.42, 0, 1, 1, [[10, 2], [16, 8]]],
      });
      expect(result).toEqual([
        'interpolate',
        ['cubic-bezier', 0.42, 0, 1, 1],
        ['zoom'],
        10, 2,
        16, 8,
      ]);
    });

    it('throws when control points are not numbers', () => {
      expect(() =>
        fslInterpolatorToMapLibre({
          cubicbezier: ['a', 'b', 'c', 'd', [[10, 2], [16, 8]]],
        })
      ).toThrow('must be numbers');
    });

    it('throws for wrong number of arguments', () => {
      expect(() =>
        fslInterpolatorToMapLibre({ cubicbezier: [0.42, 0, 1] })
      ).toThrow();
    });

    it('throws for fewer than 2 stops', () => {
      expect(() =>
        fslInterpolatorToMapLibre({ cubicbezier: [0.42, 0, 1, 1, [[10, 2]]] })
      ).toThrow('at least 2 stops');
    });
  });

  describe('pass-through for non-interpolator values', () => {
    it('returns plain numbers unchanged', () => {
      expect(fslInterpolatorToMapLibre(6)).toBe(6);
    });

    it('returns strings unchanged', () => {
      expect(fslInterpolatorToMapLibre('#ff0000')).toBe('#ff0000');
    });

    it('returns MapLibre expressions unchanged', () => {
      const expr = ['match', ['get', 'type'], 'park', '#00ff00', '#ff0000'];
      expect(fslInterpolatorToMapLibre(expr)).toBe(expr);
    });

    it('returns null unchanged', () => {
      expect(fslInterpolatorToMapLibre(null)).toBeNull();
    });
  });
});

describe('resolvePaintInterpolators', () => {
  it('converts interpolator values in a paint object', () => {
    const paint = {
      'circle-radius': { linear: [[10, 2], [16, 8]] },
      'circle-color': '#3b82f6',
      'circle-opacity': 0.85,
    };
    const result = resolvePaintInterpolators(paint);
    expect(result['circle-radius']).toEqual([
      'interpolate', ['linear'], ['zoom'], 10, 2, 16, 8,
    ]);
    expect(result['circle-color']).toBe('#3b82f6');
    expect(result['circle-opacity']).toBe(0.85);
  });

  it('leaves a paint object with no interpolators unchanged in values', () => {
    const paint = {
      'fill-color': '#22c55e',
      'fill-opacity': 0.45,
    };
    const result = resolvePaintInterpolators(paint);
    expect(result['fill-color']).toBe('#22c55e');
    expect(result['fill-opacity']).toBe(0.45);
  });

  it('handles multiple interpolators in one paint object', () => {
    const paint = {
      'line-width': { exp: [2, [[8, 1], [14, 8]]] },
      'line-color': { step: ['#eff3ff', [[12, '#6baed6'], [16, '#08519c']]] },
    };
    const result = resolvePaintInterpolators(paint);
    expect(result['line-width']).toEqual([
      'interpolate', ['exponential', 2], ['zoom'], 8, 1, 14, 8,
    ]);
    expect(result['line-color']).toEqual([
      'step', ['zoom'], '#eff3ff', 12, '#6baed6', 16, '#08519c',
    ]);
  });
});
