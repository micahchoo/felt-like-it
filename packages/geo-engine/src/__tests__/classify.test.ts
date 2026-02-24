// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { equalIntervalBreaks, quantileBreaks } from '../classify.js';
import { getColorRamp, COLOR_RAMP_NAMES, COLOR_RAMPS } from '../color-ramps.js';

// ─── equalIntervalBreaks ───────────────────────────────────────────────────────

describe('equalIntervalBreaks', () => {
  it('returns n−1 breakpoints for n classes', () => {
    const breaks = equalIntervalBreaks([0, 10, 20, 30, 40, 50], 5);
    expect(breaks).toHaveLength(4);
  });

  it('produces equal-width intervals', () => {
    const breaks = equalIntervalBreaks([0, 100], 4);
    expect(breaks).toEqual([25, 50, 75]);
  });

  it('returns [] for empty values', () => {
    expect(equalIntervalBreaks([], 5)).toEqual([]);
  });

  it('returns [] when all values are identical (degenerate)', () => {
    expect(equalIntervalBreaks([5, 5, 5], 3)).toEqual([]);
  });

  it('returns [] when nClasses < 2', () => {
    expect(equalIntervalBreaks([1, 2, 3], 1)).toEqual([]);
  });

  it('ignores NaN values', () => {
    const breaks = equalIntervalBreaks([0, NaN, 10], 2);
    expect(breaks).toHaveLength(1);
    expect(breaks[0]).toBeCloseTo(5, 5);
  });

  it('handles 2 classes (one breakpoint = midpoint)', () => {
    const breaks = equalIntervalBreaks([10, 20], 2);
    expect(breaks).toEqual([15]);
  });
});

// ─── quantileBreaks ────────────────────────────────────────────────────────────

describe('quantileBreaks', () => {
  it('returns n−1 breakpoints for uniformly distributed data', () => {
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const nClasses = 5;
    const breaks = quantileBreaks(vals, nClasses);
    expect(breaks).toHaveLength(nClasses - 1);
  });

  it('produces breaks at expected quantile positions for known data', () => {
    // For [1..10] with 5 classes, breakpoint indices are floor(10*i/5) for i=1..4
    // idx=2→val=3, idx=4→val=5, idx=6→val=7, idx=8→val=9
    const vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const breaks = quantileBreaks(vals, 5);
    expect(breaks).toEqual([3, 5, 7, 9]);
  });

  it('breaks partition data into approximately equal-sized buckets', () => {
    // 100 evenly spaced values, 4 classes -> 3 breakpoints
    // Each bucket should contain ~25 values
    const vals = Array.from({ length: 100 }, (_, i) => i + 1);
    const nClasses = 4;
    const breaks = quantileBreaks(vals, nClasses);
    expect(breaks).toHaveLength(nClasses - 1);

    const allBreaks = [0, ...breaks, 101]; // sentinels for bucket counting
    const bucketSizes = [];
    for (let i = 0; i < allBreaks.length - 1; i++) {
      const lo = allBreaks[i] ?? 0;
      const hi = allBreaks[i + 1] ?? 101;
      const count = vals.filter((v) => v > lo && v <= hi).length;
      bucketSizes.push(count);
    }
    const expectedPerBucket = vals.length / nClasses;
    for (const size of bucketSizes) {
      // Each bucket should be within 20% of the ideal size
      expect(size).toBeGreaterThanOrEqual(expectedPerBucket * 0.8);
      expect(size).toBeLessThanOrEqual(expectedPerBucket * 1.2);
    }
  });

  it('returns [] for empty values', () => {
    expect(quantileBreaks([], 5)).toEqual([]);
  });

  it('returns [] when nClasses < 2', () => {
    expect(quantileBreaks([1, 2, 3], 1)).toEqual([]);
  });

  it('deduplicates breakpoints from discrete data', () => {
    // All the same value — all breaks land at the same point
    const breaks = quantileBreaks([1, 1, 1, 1, 1], 3);
    expect(breaks.length).toBeLessThanOrEqual(1); // deduped
  });

  it('breakpoints are in ascending order', () => {
    const vals = [5, 2, 8, 1, 9, 3, 7, 4, 6, 10];
    const breaks = quantileBreaks(vals, 4);
    for (let i = 1; i < breaks.length; i++) {
      const prev = breaks[i - 1] ?? -Infinity;
      expect(breaks[i]).toBeGreaterThanOrEqual(prev);
    }
  });

  it('all breakpoints lie within [min, max]', () => {
    const vals = [10, 20, 30, 40, 50];
    const breaks = quantileBreaks(vals, 5);
    for (const b of breaks) {
      expect(b).toBeGreaterThanOrEqual(10);
      expect(b).toBeLessThanOrEqual(50);
    }
  });

  it('ignores NaN values and computes breaks from valid entries only', () => {
    const breaks = quantileBreaks([NaN, 1, 2, NaN, 3, 4], 2);
    // 4 valid values [1,2,3,4], 2 classes -> 1 breakpoint
    expect(breaks).toHaveLength(1);
    // Breakpoint should be at index floor(4*1/2)=2 in sorted [1,2,3,4] -> value 3
    expect(breaks[0]).toBe(3);
  });
});

// ─── getColorRamp ──────────────────────────────────────────────────────────────

describe('getColorRamp', () => {
  it('returns exactly n colors for n = 2..9', () => {
    for (let n = 2; n <= 9; n++) {
      expect(getColorRamp('Blues', n)).toHaveLength(n);
    }
  });

  it('clamps n < 2 to 2', () => {
    expect(getColorRamp('Blues', 1)).toHaveLength(2);
  });

  it('clamps n > 9 to 9', () => {
    expect(getColorRamp('Blues', 10)).toHaveLength(9);
  });

  it('returns a copy of the full ramp when n = 9 (not a reference to the original)', () => {
    const result = getColorRamp('Blues', 9);
    expect(result).toEqual([...COLOR_RAMPS['Blues']]);
    // Must be a copy so callers can mutate without corrupting the source ramp
    expect(result).not.toBe(COLOR_RAMPS['Blues']);
  });

  it('first and last colors match ramp endpoints for all n', () => {
    const ramp = COLOR_RAMPS['Blues'];
    for (let n = 2; n <= 9; n++) {
      const result = getColorRamp('Blues', n);
      expect(result[0]).toBe(ramp[0]);
      expect(result[result.length - 1]).toBe(ramp[ramp.length - 1]);
    }
  });

  it('returns valid hex strings for all ramps at n=5', () => {
    const hexRe = /^#[0-9a-f]{6}$/i;
    for (const name of COLOR_RAMP_NAMES) {
      const colors = getColorRamp(name, 5);
      for (const c of colors) {
        expect(c).toMatch(hexRe);
      }
    }
  });

  it('COLOR_RAMP_NAMES lists all ramps', () => {
    expect(COLOR_RAMP_NAMES).toContain('Blues');
    expect(COLOR_RAMP_NAMES).toContain('RdBu');
    expect(COLOR_RAMP_NAMES.length).toBe(9);
  });
});
