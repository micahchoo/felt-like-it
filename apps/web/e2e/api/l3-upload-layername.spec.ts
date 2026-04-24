import { test, expect } from '@playwright/test';
import { FIXTURE_API_KEY_ALICE_PLAINTEXT, FIXTURE_MAPS } from '../../src/lib/server/db/fixtures';

/**
 * L3 regression — upload layerName length cap.
 *
 * `/api/upload` accepts multipart/form-data with a `layerName` field that
 * is ultimately stored in a text column and echoed into export filenames.
 * Without a cap, an attacker can push an unbounded string through the
 * import pipeline. 120 chars is the configured limit (see MAX_LAYER_NAME
 * in the upload handler).
 *
 * The upload handler reads `locals.user`, which is set by the session-cookie
 * auth path — Bearer keys don't populate it. For the happy-path assertion
 * we therefore don't expect a 200; we only need to prove the handler does
 * NOT reject for a name-length reason when the name is within the cap.
 */

test.describe('L3: upload layerName cap', () => {
  const base = { baseURL: 'http://localhost:5173' };

  test('layerName of 1000 chars → 422', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      ...base,
      extraHTTPHeaders: { Authorization: `Bearer ${FIXTURE_API_KEY_ALICE_PLAINTEXT}` },
    });
    const res = await ctx.post('/api/upload', {
      multipart: {
        file: { name: 'tiny.geojson', mimeType: 'application/geo+json', buffer: Buffer.from('{}') },
        mapId: FIXTURE_MAPS.aliceMap,
        layerName: 'x'.repeat(1000),
      },
    });
    expect(res.status()).toBe(422);
    await ctx.dispose();
  });

  test('layerName of "Test" → not rejected for name-length reason', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      ...base,
      extraHTTPHeaders: { Authorization: `Bearer ${FIXTURE_API_KEY_ALICE_PLAINTEXT}` },
    });
    const res = await ctx.post('/api/upload', {
      multipart: {
        file: { name: 'tiny.geojson', mimeType: 'application/geo+json', buffer: Buffer.from('{}') },
        mapId: FIXTURE_MAPS.aliceMap,
        layerName: 'Test',
      },
    });
    // Bearer keys don't populate locals.user → handler returns 401.
    // 422 would mean the name-length cap fired on a valid name — that's the
    // failure mode this assertion guards against.
    expect(res.status()).not.toBe(422);
    await ctx.dispose();
  });
});
