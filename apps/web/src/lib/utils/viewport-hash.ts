/**
 * F13.1 — viewport-hash codec for share URLs.
 *
 * Encodes/parses `#zoom/lat/lng` hash fragments. Conforms to the convention
 * used by Leaflet's URL-hash plugin and Mapbox's URL state. Precision:
 *  - zoom: 2 decimals (steps small enough to feel continuous; cheap on URL)
 *  - lat/lng: 5 decimals (~1.1m at the equator — well below typical viewport
 *    scale; rounds bigger than browser float jitter)
 *
 * Pure module — no DOM, no MapLibre. Unit-testable in isolation. The
 * companion `useShareViewportHash.svelte.ts` wires this into the actual
 * `location.hash` and the map instance.
 */

export interface HashViewport {
  zoom: number;
  /** WGS84 latitude in degrees. */
  lat: number;
  /** WGS84 longitude in degrees. */
  lng: number;
}

const ZOOM_PRECISION = 2;
const LATLNG_PRECISION = 5;

/**
 * Parse `#zoom/lat/lng` (with or without leading `#`). Returns null on any
 * shape mismatch — caller falls back to the owner's saved viewport.
 *
 * Defensive on:
 *  - empty / undefined input
 *  - missing `#` prefix
 *  - wrong number of segments
 *  - non-numeric segments (NaN)
 *  - out-of-range lat/lng (Web Mercator clamp at ~85.05° lat; we accept
 *    the wider [-90, 90] / [-180, 180] range for compatibility with
 *    other tooling and let MapLibre reject internally if needed)
 *  - zoom out of MapLibre's [0, 24] range
 */
export function parseViewportHash(input: string | null | undefined): HashViewport | null {
  if (!input) return null;

  const stripped = input.startsWith('#') ? input.slice(1) : input;
  const parts = stripped.split('/');
  if (parts.length !== 3) return null;

  const zoom = Number(parts[0]);
  const lat = Number(parts[1]);
  const lng = Number(parts[2]);

  if (!Number.isFinite(zoom) || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (zoom < 0 || zoom > 24) return null;
  if (lat < -90 || lat > 90) return null;
  if (lng < -180 || lng > 180) return null;

  return { zoom, lat, lng };
}

/**
 * Format a viewport as `#zoom/lat/lng`. Always includes the leading `#`
 * so callers can pass the result directly to `history.replaceState` /
 * `location.hash`.
 *
 * Rounds per the precision constants. Negative zero normalised to `0` so
 * `serialize(parse('#0/-0/0'))` round-trips cleanly.
 */
export function serializeViewportHash(viewport: HashViewport): string {
  const z = round(viewport.zoom, ZOOM_PRECISION);
  const lat = round(viewport.lat, LATLNG_PRECISION);
  const lng = round(viewport.lng, LATLNG_PRECISION);
  return `#${z}/${lat}/${lng}`;
}

function round(value: number, decimals: number): string {
  const rounded = Number(value.toFixed(decimals));
  // Normalise -0 → 0 so round-trips don't introduce sign noise.
  const normalised = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalised);
}
