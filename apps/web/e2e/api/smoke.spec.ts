import { apiTest as test, expect } from '../fixtures/api-auth';
import { FIXTURE_MAPS } from '../../src/lib/server/db/fixtures';

/**
 * Harness smoke — proves the adversarial-testing plumbing is wired:
 * two-tenant fixtures seeded with Bearer API keys, and the list endpoint
 * scopes by owner. If these four assertions pass, the harness is ready
 * for /adversarial-api-testing to drive real probes.
 *
 * Response shape per apps/web/src/routes/api/v1/middleware.ts:envelope:
 *   { data: T, meta: {...}, links: {...} }
 */

test.describe('API harness smoke', () => {
  test('anon cannot list maps', async ({ anon }) => {
    const res = await anon.get('/api/v1/maps');
    expect(res.status()).toBe(401);
  });

  test("alice's list contains her map but not bob's (IDOR oracle)", async ({ alice }) => {
    const res = await alice.get('/api/v1/maps');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    const ids = body.data.map((m) => m.id);
    expect(ids, 'alice must see her own map').toContain(FIXTURE_MAPS.aliceMap);
    expect(ids, "alice must NOT see bob's map").not.toContain(FIXTURE_MAPS.bobMap);
  });

  test("alice cannot GET bob's map directly (IDOR probe)", async ({ alice }) => {
    const res = await alice.get(`/api/v1/maps/${FIXTURE_MAPS.bobMap}`);
    expect(
      [401, 403, 404],
      `cross-tenant read must be blocked; got ${res.status()}`,
    ).toContain(res.status());
  });

  test('bob can GET his own map (sanity: harness actually works)', async ({ bob }) => {
    const res = await bob.get(`/api/v1/maps/${FIXTURE_MAPS.bobMap}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(FIXTURE_MAPS.bobMap);
  });
});
