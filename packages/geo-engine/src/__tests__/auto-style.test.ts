import { describe, it, expect } from 'vitest';
import { generateAutoStyle } from '../auto-style.js';

const makeFeatures = (properties: Record<string, unknown>[]) =>
  properties.map((p) => ({ properties: p }));

describe('generateAutoStyle', () => {
  describe('simple styles (no data-driven field)', () => {
    it('generates circle style for point layers', () => {
      const style = generateAutoStyle('point', []);
      expect(style.type).toBe('simple');
      expect(style.paint['circle-color']).toBeDefined();
      expect(style.paint['circle-radius']).toBeDefined();
    });

    it('generates line style for line layers', () => {
      const style = generateAutoStyle('line', []);
      expect(style.type).toBe('simple');
      expect(style.paint['line-color']).toBeDefined();
      expect(style.paint['line-width']).toBeDefined();
    });

    it('generates fill style for polygon layers', () => {
      const style = generateAutoStyle('polygon', []);
      expect(style.type).toBe('simple');
      expect(style.paint['fill-color']).toBeDefined();
      expect(style.paint['fill-opacity']).toBeDefined();
    });
  });

  describe('categorical styles', () => {
    it('generates categorical style when field has string values', () => {
      const features = makeFeatures([
        { category: 'park' },
        { category: 'school' },
        { category: 'park' },
        { category: 'library' },
      ]);
      const style = generateAutoStyle('polygon', features, 'category');
      expect(style.type).toBe('categorical');
      expect(style.legend).toBeDefined();
      expect(style.legend?.length).toBeGreaterThan(0);
    });

    it('generates legend entries for each unique value', () => {
      const features = makeFeatures([
        { type: 'A' },
        { type: 'B' },
        { type: 'C' },
      ]);
      const style = generateAutoStyle('point', features, 'type');
      expect(style.legend).toHaveLength(3);
    });

    it('populates config.categoricalAttribute', () => {
      const features = makeFeatures([{ kind: 'park' }, { kind: 'school' }]);
      const style = generateAutoStyle('polygon', features, 'kind');
      expect(style.config?.categoricalAttribute).toBe('kind');
    });

    it('populates config.categories with ordered unique string values', () => {
      const features = makeFeatures([
        { type: 'A' },
        { type: 'B' },
        { type: 'A' },
        { type: 'C' },
      ]);
      const style = generateAutoStyle('point', features, 'type');
      expect(style.config?.categories).toEqual(expect.arrayContaining(['A', 'B', 'C']));
      expect(style.config?.categories).toHaveLength(3);
    });

    it('config.categories length matches legend length', () => {
      const features = makeFeatures([
        { status: 'open' },
        { status: 'closed' },
        { status: 'pending' },
      ]);
      const style = generateAutoStyle('polygon', features, 'status');
      expect(style.config?.categories?.length).toBe(style.legend?.length);
    });
  });

  describe('numeric styles', () => {
    it('generates numeric style for numeric field', () => {
      const features = makeFeatures([
        { population: 1000 },
        { population: 5000 },
        { population: 10000 },
        { population: 20000 },
        { population: 50000 },
      ]);
      const style = generateAutoStyle('polygon', features, 'population');
      expect(style.type).toBe('numeric');
      expect(style.colorRamp).toBeDefined();
      expect(style.legend).toBeDefined();
    });

    it('populates config.numericAttribute', () => {
      const features = makeFeatures([{ value: 10 }, { value: 50 }, { value: 100 }]);
      const style = generateAutoStyle('point', features, 'value');
      expect(style.config?.numericAttribute).toBe('value');
    });

    it('populates config.steps with [threshold, color] pairs', () => {
      const features = makeFeatures([
        { pop: 1000 },
        { pop: 5000 },
        { pop: 10000 },
        { pop: 20000 },
        { pop: 50000 },
      ]);
      const style = generateAutoStyle('polygon', features, 'pop');
      expect(style.config?.steps).toBeDefined();
      expect(style.config?.steps?.length).toBeGreaterThan(0);
      const step = style.config?.steps?.[0];
      expect(Array.isArray(step)).toBe(true);
      expect(typeof step?.[0]).toBe('number');
      expect(typeof step?.[1]).toBe('string');
    });

    it('config.steps length matches colorRamp length', () => {
      const features = makeFeatures([{ v: 10 }, { v: 20 }, { v: 30 }]);
      const style = generateAutoStyle('polygon', features, 'v');
      expect(style.config?.steps?.length).toBe(style.colorRamp?.length);
    });
  });

  describe('auto-detection', () => {
    it('auto-picks categorical field', () => {
      const features = makeFeatures([
        { status: 'active', id: '1' },
        { status: 'inactive', id: '2' },
        { status: 'active', id: '3' },
      ]);
      const style = generateAutoStyle('point', features);
      expect(style.type).toBe('categorical');
    });

    it('falls back to simple when no good field', () => {
      const features = makeFeatures([{ id: '1' }, { id: '2' }]);
      const style = generateAutoStyle('point', features);
      expect(style.type).toBe('simple');
    });
  });
});
