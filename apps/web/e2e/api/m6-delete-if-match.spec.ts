import { apiTest as test, expect } from '../fixtures/api-auth';
import { FIXTURE_MAPS } from '../../src/lib/server/db/fixtures';

/**
 * M6 regression — DELETE /api/v1/maps/:mapId/annotations/:id requires the
 * `If-Match` header so callers prove they observed the current version.
 * Missing header → 428 Precondition Required. Stale version → 412
 * Precondition Failed. Matching version → 204.
 *
 * M5 note: the existing `UPDATE ... WHERE version = $expected RETURNING *`
 * in annotationService.update already implements CAS, so M5 did not need a
 * code change — tested indirectly through the create→delete round-trip.
 */

const ANNOTATION_BODY = {
  anchor: {
    type: 'point' as const,
    geometry: { type: 'Point' as const, coordinates: [10, 10] },
  },
  content: {
    kind: 'single' as const,
    body: { type: 'text' as const, text: 'M6 fixture' },
  },
};

async function createAnnotation(alice: import('@playwright/test').APIRequestContext) {
  const res = await alice.post(`/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations`, {
    data: ANNOTATION_BODY,
  });
  expect(res.status(), 'fixture create must return 201').toBe(201);
  const body = (await res.json()) as { data: { id: string; version: number } };
  return body.data;
}

test.describe('M6: DELETE If-Match requirement', () => {
  test('DELETE without If-Match → 428 and annotation survives', async ({ alice }) => {
    const created = await createAnnotation(alice);
    const res = await alice.delete(
      `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations/${created.id}`,
    );
    expect(res.status()).toBe(428);

    const survives = await alice.get(
      `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations`,
    );
    const list = (await survives.json()) as { data: Array<{ id: string }> };
    expect(list.data.map((a) => a.id)).toContain(created.id);

    // Clean up with the proper header so the test leaves no residue.
    await alice.delete(`/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations/${created.id}`, {
      headers: { 'If-Match': `"${created.version}"` },
    });
  });

  test('DELETE with stale If-Match → 412', async ({ alice }) => {
    const created = await createAnnotation(alice);
    const stale = created.version + 7; // arbitrary non-matching version
    const res = await alice.delete(
      `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations/${created.id}`,
      { headers: { 'If-Match': `"${stale}"` } },
    );
    expect(res.status()).toBe(412);

    // Clean up.
    await alice.delete(`/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations/${created.id}`, {
      headers: { 'If-Match': `"${created.version}"` },
    });
  });

  test('DELETE with matching If-Match → 204', async ({ alice }) => {
    const created = await createAnnotation(alice);
    const res = await alice.delete(
      `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations/${created.id}`,
      { headers: { 'If-Match': `"${created.version}"` } },
    );
    expect(res.status()).toBe(204);

    // Verify gone.
    const list = await alice.get(`/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations`);
    const body = (await list.json()) as { data: Array<{ id: string }> };
    expect(body.data.map((a) => a.id)).not.toContain(created.id);
  });

  test('DELETE with malformed If-Match → 428', async ({ alice }) => {
    const created = await createAnnotation(alice);
    const res = await alice.delete(
      `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations/${created.id}`,
      { headers: { 'If-Match': 'not-a-version' } },
    );
    expect(res.status()).toBe(428);

    // Clean up.
    await alice.delete(`/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations/${created.id}`, {
      headers: { 'If-Match': `"${created.version}"` },
    });
  });
});
