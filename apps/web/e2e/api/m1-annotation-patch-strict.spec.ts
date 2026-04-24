import { apiTest as test, expect } from '../fixtures/api-auth';
import { FIXTURE_MAPS } from '../../src/lib/server/db/fixtures';

/**
 * M1 regression — PATCH /api/v1/maps/:mapId/annotations/:id is now a strict
 * whitelist. Extra fields (attempted identity/mapping/version forgery) must
 * 422 at the API boundary instead of relying on service-layer validation.
 *
 * Each test creates its own annotation so the suite is independent.
 */

const mapUrl = `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations`;

async function createAnnotation(alice: Parameters<Parameters<typeof test>[1]>[0]['alice']): Promise<string> {
  const res = await alice.post(mapUrl, {
    data: {
      anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
      content: { kind: 'single', body: { type: 'text', text: 'seed' } },
    },
  });
  expect([200, 201]).toContain(res.status());
  const json = await res.json();
  return json.data.id as string;
}

test.describe('M1: annotation PATCH strict whitelist', () => {
  test('PATCH with valid anchor only → 200', async ({ alice }) => {
    const id = await createAnnotation(alice);
    const res = await alice.patch(`${mapUrl}/${id}`, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [2, 2] } },
      },
    });
    expect(res.status()).toBe(200);
  });

  test('PATCH with extra `id` field → 422 VALIDATION_ERROR', async ({ alice }) => {
    const id = await createAnnotation(alice);
    const res = await alice.patch(`${mapUrl}/${id}`, {
      data: {
        id: 'forged-00000000-0000-0000-0000-000000000000',
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [3, 3] } },
      },
    });
    expect(res.status()).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe('VALIDATION_ERROR');
  });

  test('PATCH with extra `userId`/`version` → 422', async ({ alice }) => {
    const id = await createAnnotation(alice);
    const res = await alice.patch(`${mapUrl}/${id}`, {
      data: { userId: 'evil', version: 999 },
    });
    expect(res.status()).toBe(422);
  });
});
