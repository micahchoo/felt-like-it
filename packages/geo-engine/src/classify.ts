/**
 * Numeric classification methods for choropleth styling.
 *
 * Both functions return the *internal* breakpoints — i.e. the n−1 values
 * that divide the data range into n classes. The result excludes the global
 * min and max, which MapLibre's `step` expression handles implicitly (values
 * below the first breakpoint fall into the base/first-color bucket).
 *
 * Edge cases:
 *   - Empty array → []
 *   - All values identical → [] (one-class degenerate; caller should detect)
 *   - Integer data with few distinct values: quantile may produce duplicates;
 *     these are deduplicated so the step expression stays valid.
 */

export type ClassificationMethod = 'equal_interval' | 'quantile';

/**
 * Equal-interval classification: divide [min, max] into `nClasses` bins of
 * identical width. Each breakpoint is `min + width * i` for i = 1..n−1.
 *
 * Best for uniformly distributed data where every range is equally important.
 */
export function equalIntervalBreaks(values: number[], nClasses: number): number[] {
  const nums = values.filter((v) => !isNaN(v));
  if (nums.length === 0 || nClasses < 2) return [];

  const min = Math.min(...nums);
  const max = Math.max(...nums);
  if (min === max) return []; // degenerate: all values identical

  const width = (max - min) / nClasses;
  return Array.from({ length: nClasses - 1 }, (_, i) => min + width * (i + 1));
}

/**
 * Quantile classification: place breakpoints so each class contains
 * approximately the same number of features. Computed from sorted ranks.
 *
 * Best for skewed data or when equal feature density per class is desired.
 * Duplicate breakpoints (from integer/discrete data) are removed.
 */
export function quantileBreaks(values: number[], nClasses: number): number[] {
  const nums = values.filter((v) => !isNaN(v)).sort((a, b) => a - b);
  if (nums.length === 0 || nClasses < 2) return [];

  const breaks: number[] = [];
  for (let i = 1; i < nClasses; i++) {
    const idx = Math.floor((nums.length * i) / nClasses);
    const val = nums[idx];
    if (val !== undefined) breaks.push(val);
  }

  // Remove duplicates that arise with discrete/integer-valued data
  return [...new Set(breaks)];
}
