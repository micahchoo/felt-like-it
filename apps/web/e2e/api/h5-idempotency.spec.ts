import { apiTest as test, expect } from '../fixtures/api-auth';
import { FIXTURE_MAPS } from '../../src/lib/server/db/fixtures';

/**
 * H5 regression — Idempotency-Key on POST endpoints.
 *
 * Contract (see lib/server/idempotency.ts):
 *   - Same key → same response, no second row created.
 *   - No key → normal behavior.
 *   - Same key, different endpoint → 422 (guards against key reuse bugs).
 *   - Malformed key → 422 (format gate: [A-Za-z0-9_-]{16,200}).
 */

const ANNOTATIONS_PATH = `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations`;

function validKey(tag: string): string {
  // 32-char key; unique per test to avoid cross-run collisions in the 24h TTL.
  const nonce = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return `h5-${tag}-${nonce}`.replace(/[^A-Za-z0-9_-]/g, '_').padEnd(16, '0').slice(0, 64);
}

function makeAnnotationBody() {
  return {
    anchor: { type: 'point', geometry: { type: 'Point', coordinates: [10, 10] } },
    content: { kind: 'single', body: { type: 'text', text: 'h5-idempotency-probe' } },
  };
}

async function countAnnotations(ctx: import('@playwright/test').APIRequestContext): Promise<number> {
  const res = await ctx.get(`${ANNOTATIONS_PATH}?limit=100`);
  expect(res.status(), 'list must succeed').toBe(200);
  const body = (await res.json()) as { data: unknown[]; meta: { totalCount: number } };
  // Prefer server's totalCount — independent of pagination window size.
  return body.meta.totalCount;
}

test.describe('H5: Idempotency-Key on POST /annotations', () => {
  test('two POSTs with same Idempotency-Key → one insert, identical responses', async ({ alice }) => {
    const before = await countAnnotations(alice);
    const key = validKey('replay');
    const body = makeAnnotationBody();

    const r1 = await alice.post(ANNOTATIONS_PATH, {
      data: body,
      headers: { 'Idempotency-Key': key, 'content-type': 'application/json' },
    });
    expect(r1.status(), 'first POST must 201').toBe(201);
    const j1 = (await r1.json()) as { data: { id: string } };

    const r2 = await alice.post(ANNOTATIONS_PATH, {
      data: body,
      headers: { 'Idempotency-Key': key, 'content-type': 'application/json' },
    });
    expect(r2.status(), 'replay must 201 (cached)').toBe(201);
    const j2 = (await r2.json()) as { data: { id: string } };

    expect(j2.data.id, 'replay must return identical annotation id').toBe(j1.data.id);

    const after = await countAnnotations(alice);
    expect(after - before, 'exactly one annotation must be inserted').toBe(1);
  });

  test('POST without Idempotency-Key behaves normally (201, inserted)', async ({ alice }) => {
    const before = await countAnnotations(alice);
    const res = await alice.post(ANNOTATIONS_PATH, {
      data: makeAnnotationBody(),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status()).toBe(201);
    const after = await countAnnotations(alice);
    expect(after - before).toBe(1);
  });

  test('same key reused on different endpoint → 422', async ({ alice }) => {
    const key = validKey('cross');
    const r1 = await alice.post(ANNOTATIONS_PATH, {
      data: makeAnnotationBody(),
      headers: { 'Idempotency-Key': key, 'content-type': 'application/json' },
    });
    expect(r1.status(), 'first POST must 201').toBe(201);

    // Reuse the same key on /api/v1/export — different path, same user.
    const r2 = await alice.post('/api/v1/export', {
      data: { layerId: '00000000-0000-0000-0000-000000000000', format: 'geojson' },
      headers: { 'Idempotency-Key': key, 'content-type': 'application/json' },
    });
    expect(
      r2.status(),
      'reusing idempotency key across endpoints must be rejected (422)',
    ).toBe(422);
  });

  test('malformed Idempotency-Key (too short) → 422', async ({ alice }) => {
    const res = await alice.post(ANNOTATIONS_PATH, {
      data: makeAnnotationBody(),
      headers: { 'Idempotency-Key': 'short', 'content-type': 'application/json' },
    });
    expect(
      [400, 422],
      `malformed key must be rejected; got ${res.status()}`,
    ).toContain(res.status());
  });
});
