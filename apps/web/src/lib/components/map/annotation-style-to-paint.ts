/**
 * Pure helpers translating an AnnotationStyle payload into MapLibre paint
 * property overrides. Landed per Felt-parity plan Task 3.3 *without* the
 * renderer wiring, so the renderer change can be a small, focused follow-up
 * that simply spreads the result into the existing `paint={...}` constants.
 *
 * The functions are pure — given the same input they return the same output
 * — so the unit tests catch regressions before the expressions reach
 * MapLibre at runtime. A bad expression can blank an entire layer, so
 * keeping the logic here (testable) rather than inline in the renderer
 * (live-only) is intentional.
 */

import type { AnnotationStyle } from '@felt-like-it/shared-types';

const DASH_ARRAYS: Record<string, number[]> = {
  solid: [1, 0],
  dashed: [4, 2],
  dotted: [1, 2],
};

/**
 * Build LineLayer paint overrides from a style. Used for route/line anchors
 * and region outlines. Unset fields → undefined so the caller's spread only
 * overrides what the user actually chose.
 */
export function lineStylePaint(style: AnnotationStyle | null | undefined): Record<string, unknown> {
  if (!style) return {};
  const paint: Record<string, unknown> = {};
  if (style.strokeColor !== undefined) paint['line-color'] = style.strokeColor;
  if (style.strokeWidth !== undefined) paint['line-width'] = style.strokeWidth;
  if (style.strokeOpacity !== undefined) paint['line-opacity'] = style.strokeOpacity;
  if (style.strokeStyle !== undefined) {
    paint['line-dasharray'] = DASH_ARRAYS[style.strokeStyle] ?? DASH_ARRAYS['solid'];
  }
  return paint;
}

/**
 * Build FillLayer paint overrides for region anchors.
 */
export function fillStylePaint(style: AnnotationStyle | null | undefined): Record<string, unknown> {
  if (!style) return {};
  const paint: Record<string, unknown> = {};
  if (style.fillColor !== undefined) paint['fill-color'] = style.fillColor;
  if (style.fillOpacity !== undefined) paint['fill-opacity'] = style.fillOpacity;
  return paint;
}

/**
 * Build CircleLayer paint overrides for pin anchors. Maps stroke → outline,
 * fill → center fill so pins can be recolored per-annotation.
 */
export function pinStylePaint(style: AnnotationStyle | null | undefined): Record<string, unknown> {
  if (!style) return {};
  const paint: Record<string, unknown> = {};
  if (style.fillColor !== undefined) paint['circle-color'] = style.fillColor;
  if (style.fillOpacity !== undefined) paint['circle-opacity'] = style.fillOpacity;
  if (style.strokeColor !== undefined) paint['circle-stroke-color'] = style.strokeColor;
  if (style.strokeWidth !== undefined) paint['circle-stroke-width'] = style.strokeWidth;
  if (style.strokeOpacity !== undefined) paint['circle-stroke-opacity'] = style.strokeOpacity;
  return paint;
}

/**
 * Whether the pin's name-label should be rendered. Defaults to true to keep
 * current behaviour when no style is set.
 */
export function showLabelFor(style: AnnotationStyle | null | undefined): boolean {
  if (!style) return true;
  return style.showLabel !== false;
}
