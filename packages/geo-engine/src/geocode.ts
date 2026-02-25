/**
 * Nominatim geocoding client for geo-engine.
 *
 * Pure utility — no Node.js or server dependencies.
 * Pass `fetchFn` to inject a mock in tests or a custom fetch in edge runtimes.
 *
 * Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
 *   - Identify your app with a meaningful User-Agent
 *   - Maximum 1 request/second (enforced via rateDelayMs default of 1 100 ms)
 *   - No bulk geocoding without permission; batch is intended for import workflows
 */

export interface GeocodingOptions {
  /** Base URL of the Nominatim instance. Default: official OSM Nominatim. */
  nominatimUrl?: string | undefined;
  /** HTTP User-Agent string (required by Nominatim policy). */
  userAgent?: string | undefined;
  /**
   * Delay between requests in `geocodeBatch`, in milliseconds.
   * Default: 1 100 ms (Nominatim's 1 req/s policy + 100 ms buffer).
   * Set to 0 in tests to skip delays.
   */
  rateDelayMs?: number | undefined;
  /** Custom fetch implementation. Defaults to `globalThis.fetch`. */
  fetchFn?: typeof globalThis.fetch | undefined;
}

export interface GeocodedPoint {
  lat: number;
  lng: number;
  /** Human-readable display name returned by Nominatim. */
  displayName: string;
}

const DEFAULT_NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const DEFAULT_USER_AGENT =
  'felt-like-it/1.0 (self-hosted GIS; https://github.com/felt-like-it/felt-like-it)';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Geocode a single address string using Nominatim.
 * Returns null on failure (network error, 4xx/5xx, or no result found).
 */
export async function geocodeAddress(
  address: string,
  options?: GeocodingOptions
): Promise<GeocodedPoint | null> {
  const baseUrl = options?.nominatimUrl ?? DEFAULT_NOMINATIM_URL;
  const userAgent = options?.userAgent ?? DEFAULT_USER_AGENT;
  const fetchFn = options?.fetchFn ?? globalThis.fetch;

  const url =
    `${baseUrl}/search?q=${encodeURIComponent(address)}&format=jsonv2&limit=1`;

  try {
    const res = await fetchFn(url, { headers: { 'User-Agent': userAgent } });
    if (!res.ok) return null;

    const data = (await res.json()) as unknown[];
    const first = data[0] as Record<string, unknown> | undefined;
    if (!first) return null;

    const lat = parseFloat(String(first['lat'] ?? ''));
    const lon = parseFloat(String(first['lon'] ?? ''));
    if (isNaN(lat) || isNaN(lon)) return null;

    return {
      lat,
      lng: lon,
      displayName: String(first['display_name'] ?? address),
    };
  } catch {
    return null;
  }
}

/**
 * Geocode an array of address strings in sequence, respecting Nominatim's
 * rate limit via `options.rateDelayMs` (default 1 100 ms between requests).
 *
 * @param addresses  Address strings to geocode. Empty strings yield null.
 * @param onProgress Called after each address: `(completed, total)`.
 * @returns          Array of `GeocodedPoint | null` in the same order as input.
 */
export async function geocodeBatch(
  addresses: string[],
  onProgress?: (completed: number, total: number) => void | Promise<void>,
  options?: GeocodingOptions
): Promise<Array<GeocodedPoint | null>> {
  const rateDelayMs = options?.rateDelayMs ?? 1_100;
  const results: Array<GeocodedPoint | null> = [];

  for (let i = 0; i < addresses.length; i++) {
    const address = (addresses[i] ?? '').trim();
    // eslint-disable-next-line no-await-in-loop -- sequential rate-limited geocoding
    results.push(address ? await geocodeAddress(address, options) : null);

    // eslint-disable-next-line no-await-in-loop -- progress callback between sequential requests
    if (onProgress) await onProgress(i + 1, addresses.length);

    // Rate-limit: skip delay after the last request
    if (i < addresses.length - 1 && rateDelayMs > 0) {
      // eslint-disable-next-line no-await-in-loop -- intentional rate-limit delay
      await sleep(rateDelayMs);
    }
  }

  return results;
}
