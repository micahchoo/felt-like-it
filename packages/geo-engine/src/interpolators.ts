/**
 * FSL zoom interpolator → MapLibre GL expression converter.
 *
 * FSL paint values can be zoom-dependent objects instead of static values.
 * This converter detects FSL interpolator objects and converts them to
 * MapLibre's interpolate / step expressions, using zoom as the input.
 *
 * FSL interpolator formats:
 *
 *   { linear: [[zoom, value], ...] }
 *     → ["interpolate", ["linear"], ["zoom"], z1, v1, z2, v2, ...]
 *
 *   { step: [baseValue, [[zoom, value], ...]] }
 *     → ["step", ["zoom"], baseValue, z1, v1, z2, v2, ...]
 *
 *   { exp: [base, [[zoom, value], ...]] }
 *     → ["interpolate", ["exponential", base], ["zoom"], z1, v1, z2, v2, ...]
 *
 *   { cubicbezier: [x1, y1, x2, y2, [[zoom, value], ...]] }
 *     → ["interpolate", ["cubic-bezier", x1, y1, x2, y2], ["zoom"], z1, v1, ...]
 *
 * Non-interpolator values are passed through unchanged.
 */

/** A single zoom stop: [zoom, value] */
type ZoomStop = [number, unknown];

function isZoomStopArray(v: unknown): v is ZoomStop[] {
  return (
    Array.isArray(v) &&
    v.every(
      (stop) =>
        Array.isArray(stop) && stop.length === 2 && typeof stop[0] === 'number'
    )
  );
}

function flattenStops(stops: ZoomStop[]): unknown[] {
  const flat: unknown[] = [];
  for (const [zoom, value] of stops) {
    flat.push(zoom, value);
  }
  return flat;
}

/**
 * Detect whether a value is an FSL interpolator object.
 */
export function isFslInterpolator(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return 'linear' in obj || 'step' in obj || 'exp' in obj || 'cubicbezier' in obj;
}

/**
 * Convert an FSL interpolator object to a MapLibre zoom expression.
 * Returns the value unchanged if it is not an FSL interpolator.
 */
export function fslInterpolatorToMapLibre(value: unknown): unknown {
  if (!isFslInterpolator(value)) return value;

  const obj = value as Record<string, unknown>;

  // { linear: [[zoom, value], ...] }
  if ('linear' in obj) {
    const stops = obj['linear'];
    if (!isZoomStopArray(stops)) {
      throw new Error(`FSL linear interpolator: expected [[zoom, value], ...], got: ${JSON.stringify(stops)}`);
    }
    if (stops.length < 2) {
      throw new Error(`FSL linear interpolator requires at least 2 stops`);
    }
    return ['interpolate', ['linear'], ['zoom'], ...flattenStops(stops)];
  }

  // { step: [baseValue, [[zoom, value], ...]] }
  if ('step' in obj) {
    const raw = obj['step'];
    if (!Array.isArray(raw) || raw.length !== 2) {
      throw new Error(`FSL step interpolator: expected [baseValue, stops], got: ${JSON.stringify(raw)}`);
    }
    const [base, stops] = raw as [unknown, unknown];
    if (!isZoomStopArray(stops)) {
      throw new Error(`FSL step interpolator: expected [[zoom, value], ...] as second element`);
    }
    return ['step', ['zoom'], base, ...flattenStops(stops)];
  }

  // { exp: [base, [[zoom, value], ...]] }
  if ('exp' in obj) {
    const raw = obj['exp'];
    if (!Array.isArray(raw) || raw.length !== 2) {
      throw new Error(`FSL exp interpolator: expected [base, stops], got: ${JSON.stringify(raw)}`);
    }
    const [base, stops] = raw as [unknown, unknown];
    if (typeof base !== 'number') {
      throw new Error(`FSL exp interpolator: base must be a number, got: ${JSON.stringify(base)}`);
    }
    if (!isZoomStopArray(stops)) {
      throw new Error(`FSL exp interpolator: expected [[zoom, value], ...] as second element`);
    }
    if (stops.length < 2) {
      throw new Error(`FSL exp interpolator requires at least 2 stops`);
    }
    return ['interpolate', ['exponential', base], ['zoom'], ...flattenStops(stops)];
  }

  // { cubicbezier: [x1, y1, x2, y2, [[zoom, value], ...]] }
  if ('cubicbezier' in obj) {
    const raw = obj['cubicbezier'];
    if (!Array.isArray(raw) || raw.length !== 5) {
      throw new Error(`FSL cubicbezier interpolator: expected [x1, y1, x2, y2, stops], got: ${JSON.stringify(raw)}`);
    }
    const [x1, y1, x2, y2, stops] = raw as [unknown, unknown, unknown, unknown, unknown];
    if (
      typeof x1 !== 'number' ||
      typeof y1 !== 'number' ||
      typeof x2 !== 'number' ||
      typeof y2 !== 'number'
    ) {
      throw new Error(`FSL cubicbezier interpolator: x1, y1, x2, y2 must be numbers`);
    }
    if (!isZoomStopArray(stops)) {
      throw new Error(`FSL cubicbezier interpolator: expected [[zoom, value], ...] as fifth element`);
    }
    if (stops.length < 2) {
      throw new Error(`FSL cubicbezier interpolator requires at least 2 stops`);
    }
    return ['interpolate', ['cubic-bezier', x1, y1, x2, y2], ['zoom'], ...flattenStops(stops)];
  }

  return value;
}

/**
 * Walk through a MapLibre paint object and convert any FSL interpolator values
 * to MapLibre zoom expressions. Returns a new paint object.
 */
export function resolvePaintInterpolators(paint: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(paint)) {
    resolved[key] = fslInterpolatorToMapLibre(value);
  }
  return resolved;
}
