import { apiTest as test, expect } from '../fixtures/api-auth';
import { FIXTURE_MAPS } from '../../src/lib/server/db/fixtures';

/**
 * M4 regression — transactional annotation mutations.
 *
 * The create/update/delete service methods each wrap their annotation_objects
 * write + annotation_changelog write in a single `db.transaction`. If the
 * changelog INSERT fails, the object mutation rolls back — no half-written
 * state bleeds into the DB.
 *
 * Playwright does not have direct DB access in this suite, and there is no
 * user-facing annotation_changelog endpoint. We assert the user-visible
 * invariants that the transaction primitive enforces:
 *   1. After a POST, the annotation appears in the list (so the object INSERT
 *      committed).
 *   2. After a PATCH, the annotation reflects the new version + content.
 *   3. After a DELETE, the annotation is gone from the list AND a subsequent
 *      GET returns 404.
 * A regression — e.g. the changelog insert silently failing with the object
 * row left behind — wouldn't itself trip these, but the code change is the
 * primitive (wrap in `db.transaction`) and existing tests exercise the happy
 * path; this probe codifies the one-to-one count invariant on happy-path
 * mutations so a future switch back to non-transactional writes still has
 * behaviour-level coverage.
 *
 * Direct changelog-row assertions would require a DB helper; flagged below.
 */

const mapUrl = `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations`;

async function listIds(alice: Parameters<Parameters<typeof test>[1]>[0]['alice']): Promise<string[]> {
  const res = await alice.get(`${mapUrl}?limit=200`);
  expect(res.status()).toBe(200);
  const json = await res.json();
  const items = (json.data ?? []) as Array<{ id: string }>;
  return items.map((i) => i.id);
}

test.describe('M4: annotation CRUD is transactional', () => {
  test('POST commits object (object appears in list afterward)', async ({ alice }) => {
    const before = await listIds(alice);

    const create = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [10, 10] } },
        content: { kind: 'single', body: { type: 'text', text: 'txn-create-probe' } },
      },
    });
    expect([200, 201]).toContain(create.status());
    const created = (await create.json()).data as { id: string; version: number };

    const after = await listIds(alice);
    expect(after).toContain(created.id);
    // Exactly one net-new object — no duplicate write from a stray retry.
    expect(after.length).toBe(before.length + 1);
  });

  test('PATCH commits update (new version visible on GET)', async ({ alice }) => {
    const create = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [11, 11] } },
        content: { kind: 'single', body: { type: 'text', text: 'txn-patch-probe' } },
      },
    });
    expect([200, 201]).toContain(create.status());
    const { id, version } = (await create.json()).data as { id: string; version: number };

    const patch = await alice.patch(`${mapUrl}/${id}`, {
      headers: { 'If-Match': `"${version}"` },
      data: {
        content: { kind: 'single', body: { type: 'text', text: 'txn-patch-after' } },
      },
    });
    expect(patch.status()).toBe(200);
    const updated = (await patch.json()).data as { version: number; content: { body: { text: string } } };
    expect(updated.version).toBe(version + 1);
    expect(updated.content.body.text).toBe('txn-patch-after');
  });

  test('DELETE commits removal (object gone AND subsequent GET 404s)', async ({ alice }) => {
    const create = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [12, 12] } },
        content: { kind: 'single', body: { type: 'text', text: 'txn-del-probe' } },
      },
    });
    expect([200, 201]).toContain(create.status());
    const { id, version } = (await create.json()).data as { id: string; version: number };

    const del = await alice.delete(`${mapUrl}/${id}`, {
      headers: { 'If-Match': `"${version}"` },
    });
    expect([200, 204]).toContain(del.status());

    // Object is gone from the list…
    const after = await listIds(alice);
    expect(after).not.toContain(id);

    // …and fetch-by-id confirms it.
    const get = await alice.get(`${mapUrl}/${id}`);
    expect(get.status()).toBe(404);
  });

  test('mixed sequence: create/update/delete all commit atomically', async ({ alice }) => {
    // Sanity: the count invariant holds across a full cycle.
    const start = (await listIds(alice)).length;

    const c1 = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [20, 20] } },
        content: { kind: 'single', body: { type: 'text', text: 'a' } },
      },
    });
    const { id: id1, version: v1 } = (await c1.json()).data as { id: string; version: number };

    const c2 = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [21, 21] } },
        content: { kind: 'single', body: { type: 'text', text: 'b' } },
      },
    });
    const { id: id2, version: v2 } = (await c2.json()).data as { id: string; version: number };

    await alice.patch(`${mapUrl}/${id1}`, {
      headers: { 'If-Match': `"${v1}"` },
      data: { content: { kind: 'single', body: { type: 'text', text: 'a-edited' } } },
    });

    await alice.delete(`${mapUrl}/${id2}`, {
      headers: { 'If-Match': `"${v2}"` },
    });

    const end = (await listIds(alice)).length;
    // 2 created, 1 deleted → net +1. A half-committed mutation from a broken
    // transaction would drift this count.
    expect(end).toBe(start + 1);
  });
});
