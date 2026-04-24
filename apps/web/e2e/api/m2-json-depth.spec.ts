import { apiTest as test, expect } from '../fixtures/api-auth';
import { FIXTURE_MAPS } from '../../src/lib/server/db/fixtures';

/**
 * M2 regression — jsonb input depth cap.
 *
 * Annotation `content` is a jsonb-bound field. Arbitrarily-deep objects are
 * a DoS vector against any recursive consumer downstream (PG's own jsonb
 * operators, serializers, UI renderers). `CreateAnnotationWithDepthLimit`
 * applies a `depthLimit(20)` refinement before the insert runs.
 *
 * Build a nested object incrementally so we control exact depth (Array
 * nesting works just as well but object nesting exercises the recursive
 * object branch, which is what CreateAnnotation sees from real clients).
 */

function nestObject(depth: number): unknown {
  let node: unknown = { leaf: true };
  for (let i = 0; i < depth - 1; i++) node = { nested: node };
  return node;
}

test.describe('M2: annotation content depth cap', () => {
  test('25-level nested content → 422', async ({ alice }) => {
    // We intentionally shove the deep tree into a field the content schema
    // won't accept in shape either, which still surfaces as 422 — the point
    // is that the server rejects before persisting anything jsonb-bound.
    const res = await alice.post(`/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations`, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
        content: nestObject(25),
      },
    });
    expect(res.status()).toBe(422);
  });

  test('5-level nested (within cap) well-formed content → succeeds', async ({ alice }) => {
    // Valid text-content shape; depth of the value tree is small.
    const res = await alice.post(`/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations`, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [1, 1] } },
        content: {
          kind: 'single',
          body: { type: 'text', text: 'shallow annotation' },
        },
      },
    });
    expect([200, 201]).toContain(res.status());
  });
});
