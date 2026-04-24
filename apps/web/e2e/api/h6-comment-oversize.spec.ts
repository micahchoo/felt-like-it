import { apiTest as test, expect } from '../fixtures/api-auth';
import { FIXTURE_MAPS } from '../../src/lib/server/db/fixtures';

/**
 * H6 regression — POST /api/v1/maps/:mapId/comments rejects oversize bodies.
 *
 * Pre-fix the handler accepted any string in `body.body`, opening a cheap
 * row-bloat / storage-DoS vector. Zod now caps length at 5000 chars.
 */
test.describe('H6: comment body max length', () => {
  const url = `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/comments`;

  test('valid body under cap → 201', async ({ alice }) => {
    const res = await alice.post(url, { data: { body: 'hello world' } });
    expect(res.status()).toBe(201);
    const json = await res.json();
    expect(json.data.body).toBe('hello world');
  });

  test('body at 5000 chars exactly → 201 (boundary allowed)', async ({ alice }) => {
    const res = await alice.post(url, { data: { body: 'a'.repeat(5000) } });
    expect(res.status()).toBe(201);
  });

  test('body at 5001 chars → 422 VALIDATION_ERROR', async ({ alice }) => {
    const res = await alice.post(url, { data: { body: 'a'.repeat(5001) } });
    expect(res.status()).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  test('empty body → 422 (min length 1)', async ({ alice }) => {
    const res = await alice.post(url, { data: { body: '' } });
    expect(res.status()).toBe(422);
  });
});
