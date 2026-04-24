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

test.describe('Promise 16 — "Promote annotations to a data layer and back" (Felt-parity Wave 3)', () => {
  test('converts multiple annotations to a layer and deletes the sources', async ({ alice }) => {
    const a = await createPointAnnotation(alice, 'A');
    const b = await createPointAnnotation(alice, 'B');

    const convertRes = await alice.post(`/api/v1/maps/${FIXTURE_MAPS.aliceMap}/convert-annotations-to-layer`, {
      data: { annotationIds: [a.id, b.id], layerName: 'Promoted points' },
    });
    expect(convertRes.status()).toBe(201);
    const result = (await convertRes.json()).data;
    expect(result.layerId).toBeTruthy();
    expect(result.featureCount).toBe(2);
    expect(result.skipped).toHaveLength(0);

    // Source annotations are gone
    expect((await alice.get(`${mapUrl}/${a.id}`)).status()).toBe(404);
    expect((await alice.get(`${mapUrl}/${b.id}`)).status()).toBe(404);
  });

  test('viewport-anchored annotations are skipped with a reason, not deleted', async ({ alice }) => {
    // Create one point + one viewport annotation
    const pointRes = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [1, 2] } },
        content: { kind: 'single', body: { type: 'text', text: 'convertible' } },
      },
    });
    const pointId = (await pointRes.json()).data.id as string;
    const vpRes = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'viewport' },
        content: { kind: 'single', body: { type: 'text', text: 'no geometry' } },
      },
    });
    const vpId = (await vpRes.json()).data.id as string;

    const convertRes = await alice.post(`/api/v1/maps/${FIXTURE_MAPS.aliceMap}/convert-annotations-to-layer`, {
      data: { annotationIds: [pointId, vpId], layerName: 'Mixed' },
    });
    expect(convertRes.status()).toBe(201);
    const result = (await convertRes.json()).data;
    expect(result.featureCount).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe(vpId);
    expect(result.skipped[0].reason).toMatch(/viewport/i);

    // Point was consumed, viewport survived
    expect((await alice.get(`${mapUrl}/${pointId}`)).status()).toBe(404);
    expect((await alice.get(`${mapUrl}/${vpId}`)).status()).toBe(200);
  });

  test('rejects when all inputs are viewport-anchored (nothing to convert)', async ({ alice }) => {
    const vpRes = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'viewport' },
        content: { kind: 'single', body: { type: 'text', text: 'x' } },
      },
    });
    const vpId = (await vpRes.json()).data.id as string;

    const res = await alice.post(`/api/v1/maps/${FIXTURE_MAPS.aliceMap}/convert-annotations-to-layer`, {
      data: { annotationIds: [vpId], layerName: 'Empty' },
    });
    expect(res.status()).toBe(422);
    // The source annotation must not have been deleted
    expect((await alice.get(`${mapUrl}/${vpId}`)).status()).toBe(200);
  });

  test('rejects cross-tenant annotation ids', async ({ alice, bob }) => {
    const bobAnn = await bob.post(`/api/v1/maps/${FIXTURE_MAPS.bobMap}/annotations`, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
        content: { kind: 'single', body: { type: 'text', text: 'bob' } },
      },
    });
    const bobId = (await bobAnn.json()).data.id as string;

    const res = await alice.post(`/api/v1/maps/${FIXTURE_MAPS.aliceMap}/convert-annotations-to-layer`, {
      data: { annotationIds: [bobId], layerName: 'Hijack' },
    });
    expect([404, 422]).toContain(res.status());
  });
});

test.describe('Promise 17 — "Organize annotations into groups" (Felt-parity Wave 2 Groups)', () => {
  const groupsUrl = `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotation-groups`;

  test('create group and list it back', async ({ alice }) => {
    const res = await alice.post(groupsUrl, { data: { name: 'Field Sites' } });
    expect(res.status()).toBe(201);
    const created = (await res.json()).data;
    expect(created.name).toBe('Field Sites');
    expect(created.visible).toBe(true);
    expect(created.parentGroupId).toBeNull();

    const listRes = await alice.get(groupsUrl);
    expect(listRes.status()).toBe(200);
    const list = (await listRes.json()).data;
    expect(list.some((g: { id: string }) => g.id === created.id)).toBe(true);
  });

  test('assign an annotation to a group via POST then change it via PATCH', async ({ alice }) => {
    const g1 = (await (await alice.post(groupsUrl, { data: { name: 'G1' } })).json()).data.id as string;
    const g2 = (await (await alice.post(groupsUrl, { data: { name: 'G2' } })).json()).data.id as string;

    const createRes = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
        content: { kind: 'single', body: { type: 'text', text: 'grouped' } },
        groupId: g1,
      },
    });
    expect(createRes.status()).toBe(201);
    const ann = (await createRes.json()).data;
    expect(ann.groupId).toBe(g1);

    const patchRes = await alice.patch(`${mapUrl}/${ann.id}`, {
      headers: { 'If-Match': String(ann.version) },
      data: { groupId: g2 },
    });
    expect(patchRes.status()).toBe(200);
    const patched = (await patchRes.json()).data;
    expect(patched.groupId).toBe(g2);

    // Null-clear moves it to root
    const clearRes = await alice.patch(`${mapUrl}/${ann.id}`, {
      headers: { 'If-Match': String(patched.version) },
      data: { groupId: null },
    });
    expect(clearRes.status()).toBe(200);
    expect((await clearRes.json()).data.groupId).toBeNull();
  });

  test('deleting a group sets contained annotations to ungrouped', async ({ alice }) => {
    const g = (await (await alice.post(groupsUrl, { data: { name: 'Doomed' } })).json()).data.id as string;
    const ann = (await (await alice.post(mapUrl, {
      data: {
        anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
        content: { kind: 'single', body: { type: 'text', text: 'x' } },
        groupId: g,
      },
    })).json()).data.id as string;

    const del = await alice.delete(`${groupsUrl}/${g}`);
    expect(del.status()).toBe(204);

    const readBack = await alice.get(`${mapUrl}/${ann}`);
    expect(readBack.status()).toBe(200);
    expect((await readBack.json()).data.groupId).toBeNull();
  });

  test('rejects name longer than 200 chars on create', async ({ alice }) => {
    const res = await alice.post(groupsUrl, { data: { name: 'x'.repeat(201) } });
    expect(res.status()).toBe(422);
  });
});

test.describe('Promise 18 — "Style annotations individually" (Felt-parity Wave 2 Styling)', () => {
  test('style payload round-trips on create and PATCH, null-clears on PATCH', async ({ alice }) => {
    const style = {
      strokeWidth: 3,
      strokeStyle: 'dashed',
      strokeColor: '#ff0000',
      strokeOpacity: 0.7,
      showLabel: true,
    };
    const createRes = await alice.post(mapUrl, {
      data: {
        anchor: { type: 'region', geometry: { type: 'Polygon', coordinates: [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } },
        content: { kind: 'single', body: { type: 'text', text: 'styled' } },
        style,
      },
    });
    expect(createRes.status()).toBe(201);
    const created = (await createRes.json()).data;
    expect(created.style).toMatchObject(style);

    const readBack = await alice.get(`${mapUrl}/${created.id}`);
    expect((await readBack.json()).data.style).toMatchObject(style);

    const patchRes = await alice.patch(`${mapUrl}/${created.id}`, {
      headers: { 'If-Match': String(created.version) },
      data: { style: { strokeWidth: 5, strokeStyle: 'solid' } },
    });
    expect(patchRes.status()).toBe(200);
    expect((await patchRes.json()).data.style).toMatchObject({ strokeWidth: 5, strokeStyle: 'solid' });

    const clearRes = await alice.patch(`${mapUrl}/${created.id}`, {
      headers: { 'If-Match': String((await (await alice.get(`${mapUrl}/${created.id}`)).json()).data.version) },
      data: { style: null },
    });
    expect(clearRes.status()).toBe(200);
    expect((await clearRes.json()).data.style).toBeNull();
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
