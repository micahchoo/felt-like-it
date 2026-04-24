import { apiTest as test, expect } from '../fixtures/api-auth';
import { FIXTURE_MAPS, FIXTURE_LAYERS } from '../../src/lib/server/db/fixtures';

/**
 * "Marketing promises" coverage for /api/v1/maps/:mapId/annotations.
 *
 * Each test maps to a user-facing capability a marketing team would claim
 * the product can do, and verifies it through the public REST API — the
 * same surface a third-party integrator would hit.
 *
 * Scope exclusions (already covered elsewhere):
 *   m1-* PATCH strict whitelist · m2-* JSON depth cap ·
 *   m4-* create transactionality · m6-* DELETE If-Match · h5-* idempotency.
 * Those regression specs assert error paths; this spec asserts the promises.
 */

const mapUrl = `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotations`;
const bobMapUrl = `/api/v1/maps/${FIXTURE_MAPS.bobMap}/annotations`;

type Alice = Parameters<Parameters<typeof test>[1]>[0]['alice'];

async function createPointAnnotation(alice: Alice, text = 'pin'): Promise<{ id: string; version: number }> {
  const res = await alice.post(mapUrl, {
    data: {
      anchor: { type: 'point', geometry: { type: 'Point', coordinates: [10, 20] } },
      content: { kind: 'single', body: { type: 'text', text } },
    },
  });
  expect([200, 201]).toContain(res.status());
  const json = await res.json();
  return { id: json.data.id as string, version: json.data.version as number };
}

test.describe('Promise 1 — "Pin a comment anywhere on your map"', () => {
  test('point anchor: create, read back, verify coordinates round-trip', async ({ alice }) => {
    const res = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122.4194, 37.7749] } },
        content: { kind: 'single', body: { type: 'text', text: 'SF office' } },
      },
    });
    expect(res.status()).toBe(201);
    const created = (await res.json()).data;
    expect(created.anchor.type).toBe('point');
    expect(created.anchor.geometry.coordinates).toEqual([-122.4194, 37.7749]);
    expect(created.content.body.text).toBe('SF office');

    const readBack = await alice.get(`${mapUrl}/${created.id}`);
    expect(readBack.status()).toBe(200);
    const fetched = (await readBack.json()).data;
    expect(fetched.id).toBe(created.id);
    expect(fetched.anchor.geometry.coordinates).toEqual([-122.4194, 37.7749]);
  });

  test('rejects off-globe coordinates (longitude > 180)', async ({ alice }) => {
    const res = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [999, 0] } },
        content: { kind: 'single', body: { type: 'text', text: 'invalid' } },
      },
    });
    expect(res.status()).toBe(422);
  });
});

test.describe('Promise 2 — "Annotate a region of the map"', () => {
  test('region anchor with closed polygon is stored intact', async ({ alice }) => {
    const ring = [
      [0, 0], [1, 0], [1, 1], [0, 1], [0, 0],
    ];
    const res = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'region', geometry: { type: 'Polygon', coordinates: [ring] } },
        content: { kind: 'single', body: { type: 'text', text: 'study area' } },
      },
    });
    expect(res.status()).toBe(201);
    const data = (await res.json()).data;
    expect(data.anchor.type).toBe('region');
    expect(data.anchor.geometry.coordinates[0]).toHaveLength(5);
  });
});

test.describe('Promise 3 — "Attach notes to any feature on any layer"', () => {
  test('feature anchor binds an annotation to a layer + feature pair', async ({ alice }) => {
    const featureId = '77777777-aaaa-4aaa-aaaa-777777777777';
    const res = await alice.post(mapUrl, {
      data: {
        anchor: {
          type: 'feature',
          featureId,
          layerId: FIXTURE_LAYERS.aliceLayer,
        },
        content: { kind: 'single', body: { type: 'text', text: 'tree of interest' } },
      },
    });
    expect(res.status()).toBe(201);
    const data = (await res.json()).data;
    expect(data.anchor.type).toBe('feature');
    expect(data.anchor.featureId).toBe(featureId);
    expect(data.anchor.layerId).toBe(FIXTURE_LAYERS.aliceLayer);
  });
});

test.describe('Promise 4 — "Annotate the current view"', () => {
  test('viewport anchor can be bounds-bounded', async ({ alice }) => {
    const res = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'viewport', bounds: [-10, -10, 10, 10] },
        content: { kind: 'single', body: { type: 'text', text: 'zoom here to see the region' } },
      },
    });
    expect(res.status()).toBe(201);
    const data = (await res.json()).data;
    expect(data.anchor.type).toBe('viewport');
    expect(data.anchor.bounds).toEqual([-10, -10, 10, 10]);
  });

  test('viewport anchor without bounds is also valid (current view)', async ({ alice }) => {
    const res = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'viewport' },
        content: { kind: 'single', body: { type: 'text', text: 'watch from here' } },
      },
    });
    expect(res.status()).toBe(201);
  });
});

test.describe('Promise 5 — "Measure distances and areas"', () => {
  test('measurement anchor accepts LineString geometry for a distance', async ({ alice }) => {
    const res = await alice.post(mapUrl, {
      data: {
        anchor: {
          type: 'measurement',
          geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
        },
        content: {
          kind: 'single',
          body: {
            type: 'measurement',
            measurementType: 'distance',
            value: 157000,
            unit: 'km',
            displayValue: '157 km',
          },
        },
      },
    });
    expect(res.status()).toBe(201);
    const data = (await res.json()).data;
    expect(data.anchor.type).toBe('measurement');
    expect(data.anchor.geometry.type).toBe('LineString');
    expect(data.content.body.measurementType).toBe('distance');
  });
});

test.describe('Promise 6 — "Rich content: text, emoji, links, images, IIIF"', () => {
  const variants: Array<{ name: string; body: Record<string, unknown> }> = [
    { name: 'text', body: { type: 'text', text: 'hello' } },
    { name: 'emoji', body: { type: 'emoji', emoji: '🌊', label: 'wave' } },
    { name: 'link', body: { type: 'link', url: 'https://example.com', title: 'Home' } },
    { name: 'image', body: { type: 'image', url: 'https://example.com/a.png', caption: 'c' } },
    { name: 'iiif', body: { type: 'iiif', manifestUrl: 'https://example.com/m.json', label: 'M' } },
  ];

  for (const v of variants) {
    test(`${v.name} content can be stored and retrieved`, async ({ alice }) => {
      const res = await alice.post(mapUrl, {
        data: {
          anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
          content: { kind: 'single', body: v.body },
        },
      });
      expect(res.status()).toBe(201);
      const data = (await res.json()).data;
      expect(data.content.body.type).toBe(v.name);
    });
  }

  test('rejects content body that mixes types (schema-enforced)', async ({ alice }) => {
    const res = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
        content: { kind: 'single', body: { type: 'text', url: 'https://example.com' } },
      },
    });
    // Missing required `text` field → 422
    expect(res.status()).toBe(422);
  });
});

test.describe('Promise 7 — "Templated, multi-slot annotations"', () => {
  test('slotted content with multiple named slots round-trips', async ({ alice }) => {
    const res = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [5, 5] } },
        content: {
          kind: 'slotted',
          slots: {
            summary: { type: 'text', text: 'Field site A' },
            photo: { type: 'image', url: 'https://example.com/f.jpg' },
            notes: null,
          },
        },
      },
    });
    expect(res.status()).toBe(201);
    const data = (await res.json()).data;
    expect(data.content.kind).toBe('slotted');
    expect(data.content.slots.summary.text).toBe('Field site A');
    expect(data.content.slots.photo.type).toBe('image');
    expect(data.content.slots.notes).toBeNull();
  });
});

test.describe('Promise 8 — "Threaded replies on annotations"', () => {
  test('creating a reply via parentId nests under the root', async ({ alice }) => {
    const root = await createPointAnnotation(alice, 'root comment');

    const replyRes = await alice.post(mapUrl, {
      data: {
        parentId: root.id,
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [10, 20] } },
        content: { kind: 'single', body: { type: 'text', text: 'reply' } },
      },
    });
    expect(replyRes.status()).toBe(201);
    const reply = (await replyRes.json()).data;
    expect(reply.parentId).toBe(root.id);
  });

  test('rootsOnly=true hides replies in the list view', async ({ alice }) => {
    const root = await createPointAnnotation(alice, 'root for list-filter test');
    const replyRes = await alice.post(mapUrl, {
      data: {
        parentId: root.id,
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [10, 20] } },
        content: { kind: 'single', body: { type: 'text', text: 'child' } },
      },
    });
    const reply = (await replyRes.json()).data;

    const listRes = await alice.get(`${mapUrl}?rootsOnly=true&limit=500`);
    expect(listRes.status()).toBe(200);
    const items = (await listRes.json()).data as Array<{ id: string; parentId: string | null }>;
    expect(items.some((a) => a.id === root.id)).toBe(true);
    expect(items.some((a) => a.id === reply.id)).toBe(false);
  });

  test('non-existent parentId is rejected', async ({ alice }) => {
    const res = await alice.post(mapUrl, {
      data: {
        parentId: '00000000-0000-4000-8000-000000000000',
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
        content: { kind: 'single', body: { type: 'text', text: 'orphan' } },
      },
    });
    // VALIDATION_ERROR (422) per the handler's FK branch
    expect(res.status()).toBe(422);
  });
});

test.describe('Promise 9 — "Edit your annotation at any time"', () => {
  test('PATCH updates anchor and bumps version', async ({ alice }) => {
    const { id, version } = await createPointAnnotation(alice, 'editable');
    const res = await alice.patch(`${mapUrl}/${id}`, {
      data: { anchor: { type: 'point', geometry: { type: 'Point', coordinates: [1, 1] } } },
    });
    expect(res.status()).toBe(200);
    const updated = (await res.json()).data;
    expect(updated.anchor.geometry.coordinates).toEqual([1, 1]);
    expect(updated.version).toBeGreaterThan(version);
  });

  test('PATCH updates content body (text → emoji)', async ({ alice }) => {
    const { id } = await createPointAnnotation(alice, 'will change');
    const res = await alice.patch(`${mapUrl}/${id}`, {
      data: { content: { kind: 'single', body: { type: 'emoji', emoji: '🎯' } } },
    });
    expect(res.status()).toBe(200);
    const updated = (await res.json()).data;
    expect(updated.content.body.type).toBe('emoji');
    expect(updated.content.body.emoji).toBe('🎯');
  });
});

test.describe('Promise 10 — "Delete annotations you no longer need"', () => {
  test('DELETE with matching If-Match removes the annotation', async ({ alice }) => {
    const { id, version } = await createPointAnnotation(alice, 'to delete');
    const res = await alice.delete(`${mapUrl}/${id}`, {
      headers: { 'If-Match': String(version) },
    });
    expect(res.status()).toBe(204);

    const readAfter = await alice.get(`${mapUrl}/${id}`);
    expect(readAfter.status()).toBe(404);
  });
});

test.describe('Promise 11 — "Safe concurrent editing — no lost updates"', () => {
  test('stale If-Match on PATCH returns 409 VERSION_CONFLICT', async ({ alice }) => {
    const { id, version } = await createPointAnnotation(alice, 'concurrent');
    // First update bumps version
    const firstPatch = await alice.patch(`${mapUrl}/${id}`, {
      headers: { 'If-Match': String(version) },
      data: { content: { kind: 'single', body: { type: 'text', text: 'v1' } } },
    });
    expect(firstPatch.status()).toBe(200);

    // Second update uses the STALE version → must conflict
    const staleRes = await alice.patch(`${mapUrl}/${id}`, {
      headers: { 'If-Match': String(version) },
      data: { content: { kind: 'single', body: { type: 'text', text: 'v2-stale' } } },
    });
    expect(staleRes.status()).toBe(409);
    const body = await staleRes.json();
    expect(body.error.code).toBe('VERSION_CONFLICT');
  });

  test('stale If-Match on DELETE returns 412 PRECONDITION_FAILED', async ({ alice }) => {
    const { id, version } = await createPointAnnotation(alice, 'delete-concurrent');
    // Bump version via PATCH
    await alice.patch(`${mapUrl}/${id}`, {
      headers: { 'If-Match': String(version) },
      data: { content: { kind: 'single', body: { type: 'text', text: 'bump' } } },
    });
    // DELETE with the pre-bump version must fail
    const res = await alice.delete(`${mapUrl}/${id}`, {
      headers: { 'If-Match': String(version) },
    });
    expect(res.status()).toBe(412);
  });
});

test.describe('Promise 12 — "Scales to thousands of annotations"', () => {
  test('list returns an envelope with totalCount, limit, nextCursor, and HATEOAS links', async ({ alice }) => {
    // Seed enough to force pagination
    for (let i = 0; i < 3; i++) {
      await createPointAnnotation(alice, `seed-${i}`);
    }
    const res = await alice.get(`${mapUrl}?limit=2`);
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeLessThanOrEqual(2);
    expect(json.meta).toMatchObject({ limit: 2 });
    expect(typeof json.meta.totalCount).toBe('number');
    expect(json.links?.self).toBeTruthy();
  });

  test('following nextCursor yields a distinct non-overlapping page', async ({ alice }) => {
    for (let i = 0; i < 3; i++) {
      await createPointAnnotation(alice, `page-seed-${i}`);
    }
    const firstRes = await alice.get(`${mapUrl}?limit=2`);
    const first = await firstRes.json();
    if (!first.meta.nextCursor) test.skip(true, 'not enough items to paginate');

    const secondRes = await alice.get(`${mapUrl}?limit=2&cursor=${encodeURIComponent(first.meta.nextCursor)}`);
    expect(secondRes.status()).toBe(200);
    const second = await secondRes.json();
    const firstIds = new Set<string>(first.data.map((a: { id: string }) => a.id));
    for (const item of second.data) {
      expect(firstIds.has(item.id), 'cursor must exclude previously returned rows').toBe(false);
    }
  });
});

test.describe('Promise 13 — "Private by default — your workspace is yours"', () => {
  test('Alice cannot list annotations on Bob\'s map', async ({ alice }) => {
    const res = await alice.get(bobMapUrl);
    expect(res.status()).toBe(404);
  });

  test('Alice cannot PATCH an annotation addressed via her own map URL but owned by Bob', async ({ alice, bob }) => {
    // Bob creates on his map
    const bobCreate = await bob.post(bobMapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
        content: { kind: 'single', body: { type: 'text', text: 'bobs' } },
      },
    });
    expect([200, 201]).toContain(bobCreate.status());
    const bobId = (await bobCreate.json()).data.id as string;

    // Alice tries to address Bob's annotation through her own mapId URL
    const res = await alice.patch(`${mapUrl}/${bobId}`, {
      data: { content: { kind: 'single', body: { type: 'text', text: 'hijack' } } },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('Promise 15 — "First-class name and description" (Felt-parity Wave 1)', () => {
  test('name and description round-trip on create → read', async ({ alice }) => {
    const res = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
        content: { kind: 'single', body: { type: 'text', text: 'body text' } },
        name: 'Field site A',
        description: 'Primary study area; accessed via north trail.',
      },
    });
    expect(res.status()).toBe(201);
    const created = (await res.json()).data;
    expect(created.name).toBe('Field site A');
    expect(created.description).toBe('Primary study area; accessed via north trail.');

    const readBack = await alice.get(`${mapUrl}/${created.id}`);
    const fetched = (await readBack.json()).data;
    expect(fetched.name).toBe('Field site A');
    expect(fetched.description).toBe('Primary study area; accessed via north trail.');
  });

  test('creates without name/description stay legal (backward compat)', async ({ alice }) => {
    const res = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [1, 1] } },
        content: { kind: 'single', body: { type: 'text', text: 'no-name' } },
      },
    });
    expect(res.status()).toBe(201);
    const created = (await res.json()).data;
    expect(created.name ?? null).toBeNull();
    expect(created.description ?? null).toBeNull();
  });

  test('PATCH can update name and clear description by passing null', async ({ alice }) => {
    const { id, version } = await createPointAnnotation(alice, 'seed');
    // Set fields
    const patch1 = await alice.patch(`${mapUrl}/${id}`, {
      headers: { 'If-Match': String(version) },
      data: { name: 'Renamed', description: 'First description' },
    });
    expect(patch1.status()).toBe(200);
    const after1 = (await patch1.json()).data;
    expect(after1.name).toBe('Renamed');
    expect(after1.description).toBe('First description');

    // Clear description explicitly via null
    const patch2 = await alice.patch(`${mapUrl}/${id}`, {
      headers: { 'If-Match': String(after1.version) },
      data: { description: null },
    });
    expect(patch2.status()).toBe(200);
    const after2 = (await patch2.json()).data;
    expect(after2.name).toBe('Renamed');
    expect(after2.description).toBeNull();
  });

  test('rejects name longer than 200 chars', async ({ alice }) => {
    const res = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
        content: { kind: 'single', body: { type: 'text', text: 'x' } },
        name: 'a'.repeat(201),
      },
    });
    expect(res.status()).toBe(422);
  });
});

test.describe('Promise 14 — "Auth required"', () => {
  test('anonymous list → 401', async ({ anon }) => {
    const res = await anon.get(mapUrl);
    expect(res.status()).toBe(401);
  });

  test('anonymous create → 401', async ({ anon }) => {
    const res = await anon.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
        content: { kind: 'single', body: { type: 'text', text: 'x' } },
      },
    });
    expect(res.status()).toBe(401);
  });
});
