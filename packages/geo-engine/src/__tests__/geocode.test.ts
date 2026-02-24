import { describe, it, expect, vi, beforeEach } from 'vitest';
import { geocodeAddress, geocodeBatch } from '../geocode.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeNominatimResponse(lat: string, lon: string, displayName = 'Test, Place'): unknown[] {
  return [{ lat, lon, display_name: displayName }];
}

function makeFetch(response: unknown, status = 200): typeof fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(response),
  }) as unknown as typeof fetch;
}

// Zero-delay options so tests run fast
const FAST: Parameters<typeof geocodeAddress>[1] = { rateDelayMs: 0 };

// ─── geocodeAddress ───────────────────────────────────────────────────────────

describe('geocodeAddress', () => {
  it('returns a point for a successful Nominatim response', async () => {
    const fetchFn = makeFetch(makeNominatimResponse('48.8566', '2.3522', 'Paris, France'));
    const result = await geocodeAddress('Paris, France', { fetchFn, ...FAST });

    expect(result).toEqual({ lat: 48.8566, lng: 2.3522, displayName: 'Paris, France' });
  });

  it('URL-encodes the address in the request', async () => {
    const fetchFn = makeFetch(makeNominatimResponse('51.5074', '-0.1278'));
    await geocodeAddress('London, UK', { fetchFn, ...FAST });

    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain(encodeURIComponent('London, UK'));
    expect(calledUrl).toContain('format=jsonv2');
  });

  it('uses custom nominatimUrl when provided', async () => {
    const fetchFn = makeFetch(makeNominatimResponse('0', '0'));
    await geocodeAddress('test', { fetchFn, nominatimUrl: 'http://my-nominatim:8080', ...FAST });

    const calledUrl = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain('http://my-nominatim:8080/search');
  });

  it('sends the User-Agent header', async () => {
    const fetchFn = makeFetch(makeNominatimResponse('0', '0'));
    await geocodeAddress('test', { fetchFn, userAgent: 'my-app/1.0', ...FAST });

    const opts = (fetchFn as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect((opts.headers as Record<string, string>)['User-Agent']).toBe('my-app/1.0');
  });

  it('returns null when Nominatim returns an empty array', async () => {
    const fetchFn = makeFetch([]);
    const result = await geocodeAddress('Unknown Address 99999', { fetchFn, ...FAST });
    expect(result).toBeNull();
  });

  it('returns null on HTTP error', async () => {
    const fetchFn = makeFetch(null, 500);
    const result = await geocodeAddress('test', { fetchFn, ...FAST });
    expect(result).toBeNull();
  });

  it('returns null on network error (fetch throws)', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('Network error')) as unknown as typeof fetch;
    const result = await geocodeAddress('test', { fetchFn, ...FAST });
    expect(result).toBeNull();
  });

  it('returns null when lat/lon fields are missing from the result', async () => {
    const fetchFn = makeFetch([{ display_name: 'Weird response' }]);
    const result = await geocodeAddress('test', { fetchFn, ...FAST });
    expect(result).toBeNull();
  });

  it('falls back to the input address when display_name is missing', async () => {
    const fetchFn = makeFetch([{ lat: '10', lon: '20' }]);
    const result = await geocodeAddress('my address', { fetchFn, ...FAST });
    expect(result?.displayName).toBe('my address');
  });
});

// ─── geocodeBatch ─────────────────────────────────────────────────────────────

describe('geocodeBatch', () => {
  beforeEach(() => vi.clearAllMocks());

  it('geocodes each address and returns results in order', async () => {
    const fetchFn = (vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makeNominatimResponse('48.8566', '2.3522', 'Paris')) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makeNominatimResponse('51.5074', '-0.1278', 'London')) })
    ) as unknown as typeof fetch;

    const results = await geocodeBatch(['Paris', 'London'], undefined, { fetchFn, rateDelayMs: 0 });

    expect(results).toHaveLength(2);
    expect(results[0]?.lat).toBe(48.8566);
    expect(results[0]?.displayName).toBe('Paris');
    expect(results[1]?.lng).toBe(-0.1278);
  });

  it('returns null for empty address strings without making a request', async () => {
    const fetchFn = makeFetch(makeNominatimResponse('0', '0'));
    const results = await geocodeBatch(['', '  '], undefined, { fetchFn, rateDelayMs: 0 });

    expect(results).toEqual([null, null]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns null entries for failed geocoding without stopping the batch', async () => {
    const fetchFn = (vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })      // Paris → null
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(makeNominatimResponse('35.6762', '139.6503', 'Tokyo')) })
    ) as unknown as typeof fetch;

    const results = await geocodeBatch(['Nowhere', 'Tokyo'], undefined, { fetchFn, rateDelayMs: 0 });

    expect(results[0]).toBeNull();
    expect(results[1]?.displayName).toBe('Tokyo');
  });

  it('calls onProgress after each address', async () => {
    const fetchFn = (vi.fn()
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(makeNominatimResponse('0', '0')) })
    ) as unknown as typeof fetch;
    const onProgress = vi.fn();

    await geocodeBatch(['A', 'B', 'C'], onProgress, { fetchFn, rateDelayMs: 0 });

    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, 1, 3);
    expect(onProgress).toHaveBeenNthCalledWith(3, 3, 3);
  });

  it('returns an empty array for an empty input', async () => {
    const results = await geocodeBatch([], undefined, { rateDelayMs: 0 });
    expect(results).toEqual([]);
  });

  it('does not add a delay after the final request', async () => {
    // rateDelayMs: 500 with 1 address → no delay at end
    const fetchFn = makeFetch(makeNominatimResponse('0', '0'));
    const start = Date.now();
    await geocodeBatch(['single'], undefined, { fetchFn, rateDelayMs: 500 });
    expect(Date.now() - start).toBeLessThan(400); // no delay added
  });
});
