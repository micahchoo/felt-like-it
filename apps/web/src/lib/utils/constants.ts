/**
 * Feature count threshold above which a layer switches from GeoJSON source to
 * Martin vector tiles. 10K is a safe browser limit for smooth GeoJSON rendering.
 * Requires PUBLIC_MARTIN_URL to be set (non-empty string).
 *
 * Used by both MapCanvas (tile rendering) and MapEditor (skip GeoJSON fetch).
 */
export const VECTOR_TILE_THRESHOLD = 10_000;
