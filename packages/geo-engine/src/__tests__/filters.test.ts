import { describe, it, expect } from 'vitest';
import { fslFilterToMapLibre, fslFiltersToMapLibre } from '../filters.js';

describe('fslFilterToMapLibre', () => {
  describe('comparison operators', () => {
    it('converts lt to MapLibre < expression', () => {
      expect(fslFilterToMapLibre(['population', 'lt', 1000])).toEqual([
        '<', ['get', 'population'], 1000,
      ]);
    });

    it('converts gt to MapLibre > expression', () => {
      expect(fslFilterToMapLibre(['area', 'gt', 500])).toEqual([
        '>', ['get', 'area'], 500,
      ]);
    });

    it('converts le to MapLibre <= expression', () => {
      expect(fslFilterToMapLibre(['rank', 'le', 10])).toEqual([
        '<=', ['get', 'rank'], 10,
      ]);
    });

    it('converts ge to MapLibre >= expression', () => {
      expect(fslFilterToMapLibre(['score', 'ge', 0])).toEqual([
        '>=', ['get', 'score'], 0,
      ]);
    });

    it('converts eq to MapLibre == expression', () => {
      expect(fslFilterToMapLibre(['status', 'eq', 'active'])).toEqual([
        '==', ['get', 'status'], 'active',
      ]);
    });

    it('converts ne to MapLibre != expression', () => {
      expect(fslFilterToMapLibre(['type', 'ne', 'park'])).toEqual([
        '!=', ['get', 'type'], 'park',
      ]);
    });
  });

  describe('membership operators', () => {
    it('converts in to MapLibre in expression with array spread', () => {
      expect(fslFilterToMapLibre(['status', 'in', ['active', 'pending']])).toEqual([
        'in', ['get', 'status'], 'active', 'pending',
      ]);
    });

    it('converts ni to MapLibre !in expression', () => {
      expect(fslFilterToMapLibre(['type', 'ni', ['highway', 'motorway']])).toEqual([
        '!in', ['get', 'type'], 'highway', 'motorway',
      ]);
    });

    it('converts cn (contains) to MapLibre in expression', () => {
      // FSL "contains" uses ["in", searchValue, ["get", field]]
      expect(fslFilterToMapLibre(['name', 'cn', 'Park'])).toEqual([
        'in', 'Park', ['get', 'name'],
      ]);
    });
  });

  describe('compound operators', () => {
    it('converts and to MapLibre all expression', () => {
      expect(
        fslFilterToMapLibre([
          'and',
          'and',
          [
            ['status', 'eq', 'active'],
            ['population', 'gt', 100],
          ],
        ])
      ).toEqual([
        'all',
        ['==', ['get', 'status'], 'active'],
        ['>', ['get', 'population'], 100],
      ]);
    });

    it('converts or to MapLibre any expression', () => {
      expect(
        fslFilterToMapLibre([
          'or',
          'or',
          [
            ['type', 'eq', 'park'],
            ['type', 'eq', 'garden'],
          ],
        ])
      ).toEqual([
        'any',
        ['==', ['get', 'type'], 'park'],
        ['==', ['get', 'type'], 'garden'],
      ]);
    });

    it('handles nested compound filters', () => {
      // (a > 10 AND b < 20) OR c == "test"
      const filter = [
        'or',
        'or',
        [
          ['and', 'and', [['a', 'gt', 10], ['b', 'lt', 20]]],
          ['c', 'eq', 'test'],
        ],
      ];
      expect(fslFilterToMapLibre(filter)).toEqual([
        'any',
        ['all', ['>', ['get', 'a'], 10], ['<', ['get', 'b'], 20]],
        ['==', ['get', 'c'], 'test'],
      ]);
    });
  });

  describe('error handling', () => {
    it('throws for non-array input', () => {
      expect(() => fslFilterToMapLibre('invalid')).toThrow();
    });

    it('throws for wrong-length array', () => {
      expect(() => fslFilterToMapLibre(['a', 'eq'])).toThrow();
      expect(() => fslFilterToMapLibre(['a', 'eq', 1, 'extra'])).toThrow();
    });

    it('throws for unknown operator', () => {
      expect(() => fslFilterToMapLibre(['field', 'like', 'pattern'])).toThrow('Unknown FSL filter operator');
    });

    it('throws for non-string operator', () => {
      expect(() => fslFilterToMapLibre(['field', 42, 'value'])).toThrow();
    });

    it('throws for non-string field with comparison operator', () => {
      expect(() => fslFilterToMapLibre([42, 'eq', 'value'])).toThrow();
    });

    it('throws for in operator with non-array operand', () => {
      expect(() => fslFilterToMapLibre(['field', 'in', 'not-an-array'])).toThrow();
    });

    it('throws for ni operator with non-array operand', () => {
      expect(() => fslFilterToMapLibre(['field', 'ni', 'not-an-array'])).toThrow();
    });

    it('throws for and operator with non-array operand', () => {
      expect(() => fslFilterToMapLibre(['and', 'and', 'not-an-array'])).toThrow();
    });
  });
});

describe('fslFiltersToMapLibre', () => {
  it('returns null for empty filters array', () => {
    expect(fslFiltersToMapLibre([])).toBeNull();
  });

  it('returns single filter directly (no all wrapper)', () => {
    const result = fslFiltersToMapLibre([['status', 'eq', 'active']]);
    expect(result).toEqual(['==', ['get', 'status'], 'active']);
  });

  it('wraps multiple filters in all', () => {
    const result = fslFiltersToMapLibre([
      ['status', 'eq', 'active'],
      ['population', 'gt', 1000],
    ]);
    expect(result).toEqual([
      'all',
      ['==', ['get', 'status'], 'active'],
      ['>', ['get', 'population'], 1000],
    ]);
  });

  it('handles three filters with all wrapper', () => {
    const result = fslFiltersToMapLibre([
      ['a', 'eq', 1],
      ['b', 'gt', 2],
      ['c', 'ne', 3],
    ]);
    expect(result).toEqual([
      'all',
      ['==', ['get', 'a'], 1],
      ['>', ['get', 'b'], 2],
      ['!=', ['get', 'c'], 3],
    ]);
  });
});
