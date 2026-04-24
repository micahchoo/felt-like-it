import { apiTest as test, expect } from '../fixtures/api-auth';
import { FIXTURE_LAYERS } from '../../src/lib/server/db/fixtures';

/**
 * H7 regression — POST /api/v1/export/:layerId caps `title` (500 chars) and
 * `screenshot` (2_000_000 chars). Pre-fix both were spread unvalidated into
 * exportAsPdf, allowing an attacker to force a multi-MB render per request.
 * SvelteKit's error(422, msg) returns a JSON envelope `{ message: "..." }`.
 */
test.describe('H7: export POST input caps', () => {
  const url = `/api/v1/export/${FIXTURE_LAYERS.aliceLayer}`;

  test('valid short title → 200 (PDF)', async ({ alice }) => {
    const res = await alice.post(url, { data: { title: 'My Map' } });
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('application/pdf');
  });

  test('title at 500 chars → 200 (boundary allowed)', async ({ alice }) => {
    const res = await alice.post(url, { data: { title: 't'.repeat(500) } });
    expect(res.status()).toBe(200);
  });

  test('title at 501 chars → 422', async ({ alice }) => {
    const res = await alice.post(url, { data: { title: 't'.repeat(501) } });
    expect(res.status()).toBe(422);
  });

  test('screenshot at 2_000_001 chars → 422', async ({ alice }) => {
    const res = await alice.post(url, { data: { screenshot: 'x'.repeat(2_000_001) } });
    expect(res.status()).toBe(422);
  });

  test('extra field rejected by strict schema → 422', async ({ alice }) => {
    const res = await alice.post(url, { data: { title: 'ok', evil: 'payload' } });
    expect(res.status()).toBe(422);
  });
});
