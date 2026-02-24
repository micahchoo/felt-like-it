/**
 * ColorBrewer-derived sequential and diverging color ramps.
 *
 * Each ramp holds exactly 9 stops ordered low→high (sequential) or
 * negative→neutral→positive (diverging). When fewer than 9 classes are
 * requested, `getColorRamp` selects evenly-spaced indices so every step
 * count from 2–9 produces a visually coherent subset.
 *
 * Reference: Cynthia Brewer, colorbrewer2.org (Apache-2.0 license)
 */

// ─── Ramp definitions (9-stop canonical form) ─────────────────────────────────

export const COLOR_RAMPS = {
  // Sequential — light (low) to saturated (high)
  Blues:   ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
  Greens:  ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
  Oranges: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704'],
  Reds:    ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'],
  Purples: ['#fcfbfd', '#efedf5', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d'],
  YlOrRd:  ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
  // Diverging — saturated-neg → neutral → saturated-pos
  RdBu:    ['#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#f7f7f7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac'],
  RdYlGn:  ['#d73027', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850'],
  PiYG:    ['#8e0152', '#c51b7d', '#de77ae', '#f1b6da', '#fde0ef', '#e6f5d0', '#b8e186', '#7fbc41', '#4d9221'],
} as const;

export type ColorRampName = keyof typeof COLOR_RAMPS;

/** All available color ramp names in display order. */
export const COLOR_RAMP_NAMES: ColorRampName[] = [
  'Blues', 'Greens', 'Oranges', 'Reds', 'Purples', 'YlOrRd',
  'RdBu', 'RdYlGn', 'PiYG',
];

/**
 * Return exactly `n` colors (2 ≤ n ≤ 9) from a named 9-stop ramp.
 * Selects evenly-spaced indices so the result spans the full ramp extent.
 */
export function getColorRamp(name: ColorRampName, n: number): string[] {
  const clamped = Math.max(2, Math.min(9, Math.round(n)));
  const ramp = COLOR_RAMPS[name];
  if (clamped === 9) return [...ramp];
  const step = (ramp.length - 1) / (clamped - 1);
  return Array.from(
    { length: clamped },
    (_, i) => ramp[Math.round(i * step)] ?? ramp[ramp.length - 1] ?? '#000000'
  );
}
