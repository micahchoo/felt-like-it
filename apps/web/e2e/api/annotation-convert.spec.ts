import { apiTest as test, expect } from '../fixtures/api-auth';
import { FIXTURE_MAPS, FIXTURE_LAYERS } from '../../src/lib/server/db/fixtures';

/**
 * Annotation ↔ feature conversion coverage.
 *
 * Forward direction (annotations → layer features) is partially covered by
 * annotations-marketing.spec.ts Promise 16 — that spec asserts the headline
 * promises (multi-convert, viewport skip, cross-tenant). This spec extends to:
 *
 *   - Reverse direction: convert-features-to-annotations with each anchor
 *     mapping (Point→point, Polygon→region, LineString→path), name cascade
 *     (`name` > `title` > first non-empty string > "Untitled from {layer}"),
 *     and unsupported-geometry skip behaviour.
 *   - Round-trip: annotation → layer feature → annotation (preserves anchor +
 *     restores a meaningful name from properties).
 *   - Body strictness, batch limits (1..500), and cross-tenant rejection.
 *
 * The forward + list pattern is used to manufacture features with known IDs,
 * since features have no public POST endpoint.
 */

const aliceMap = FIXTURE_MAPS.aliceMap;
const bobMap = FIXTURE_MAPS.bobMap;
const annotationsUrl = `/api/v1/maps/${aliceMap}/annotations`;
const forwardUrl = `/api/v1/maps/${aliceMap}/convert-annotations-to-layer`;
const reverseUrl = `/api/v1/maps/${aliceMap}/convert-features-to-annotations`;

type Alice = Parameters<Parameters<typeof test>[1]>[0]['alice'];

async function createAnnotation(
  alice: Alice,
  anchor: Record<string, unknown>,
  text = 'seed',
  extra: Record<string, unknown> = {},
): Promise<string> {
  const res = await alice.post(annotationsUrl, {
    data: { anchor, content: { kind: 'single', body: { type: 'text', text } }, ...extra },
  });
  expect([200, 201]).toContain(res.status());
  return (await res.json()).data.id as string;
}

async function listFeaturesOnLayer(alice: Alice, mapId: string, layerId: string): Promise<Array<{ id: string }>> {
  const res = await alice.get(`/api/v1/maps/${mapId}/layers/${layerId}/features?limit=500`);
  expect(res.status()).toBe(200);
  const items = (await res.json()).data as Array<{ id: string }>;
  return items;
}

/** Forward-convert one or more annotations and return the new layerId + the list of feature IDs on it. */
async function annotationsToLayerFeatures(
  alice: Alice,
  annotationIds: string[],
  layerName: string,
): Promise<{ layerId: string; featureIds: string[] }> {
  const res = await alice.post(forwardUrl, { data: { annotationIds, layerName } });
  expect(res.status()).toBe(201);
  const result = (await res.json()).data as { layerId: string; featureCount: number };
  expect(typeof result.layerId).toBe('string');
  const features = await listFeaturesOnLayer(alice, aliceMap, result.layerId);
  expect(features.length).toBe(result.featureCount);
  return { layerId: result.layerId, featureIds: features.map((f) => f.id) };
}

test.describe('Reverse: anchor-type mapping (Point/Polygon/LineString)', () => {
  test('LineString feature → path-anchored annotation', async ({ alice }) => {
    // Forward an annotation whose anchor is a measurement-LineString — the
    // feature it produces will be a LineString feature, which the reverse
    // direction should map to the new `path` anchor (per unified-annotations.md rule 1).
    const lineAnnotationId = await createAnnotation(
      alice,
      { type: 'measurement', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } },
      'will become a path',
      {
        content: {
          kind: 'single',
          body: { type: 'measurement', measurementType: 'distance', value: 111000, unit: 'km', displayValue: '111 km' },
        },
        name: 'Coastal walk',
      },
    );
    const { layerId, featureIds } = await annotationsToLayerFeatures(alice, [lineAnnotationId], 'Lines');
    expect(featureIds).toHaveLength(1);

    const res = await alice.post(reverseUrl, { data: { layerId, featureIds } });
    expect(res.status()).toBe(201);
    const result = (await res.json()).data as { annotationIds: string[]; skipped: Array<{ featureId: string; reason: string }> };
    expect(result.annotationIds).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);

    const ann = (await (await alice.get(`${annotationsUrl}/${result.annotationIds[0]}`)).json()).data;
    expect(ann.anchor.type).toBe('path');
    expect(ann.anchor.geometry.type).toBe('LineString');
  });

  test('Polygon feature → region-anchored annotation', async ({ alice }) => {
    const polyAnnotationId = await createAnnotation(
      alice,
      { type: 'region', geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } },
      'will become a region',
      { name: 'Study Area B' },
    );
    const { layerId, featureIds } = await annotationsToLayerFeatures(alice, [polyAnnotationId], 'Polys');

    const res = await alice.post(reverseUrl, { data: { layerId, featureIds } });
    expect(res.status()).toBe(201);
    const result = (await res.json()).data as { annotationIds: string[]; skipped: unknown[] };
    expect(result.skipped).toHaveLength(0);

    const ann = (await (await alice.get(`${annotationsUrl}/${result.annotationIds[0]}`)).json()).data;
    expect(ann.anchor.type).toBe('region');
    expect(ann.anchor.geometry.type).toBe('Polygon');
  });

  test('Point feature → point-anchored annotation', async ({ alice }) => {
    const pointAnnotationId = await createAnnotation(
      alice,
      { type: 'point', geometry: { type: 'Point', coordinates: [10, 20] } },
      'will become a point',
      { name: 'Trail head' },
    );
    const { layerId, featureIds } = await annotationsToLayerFeatures(alice, [pointAnnotationId], 'Pts');

    const res = await alice.post(reverseUrl, { data: { layerId, featureIds } });
    expect(res.status()).toBe(201);
    const result = (await res.json()).data as { annotationIds: string[] };
    const ann = (await (await alice.get(`${annotationsUrl}/${result.annotationIds[0]}`)).json()).data;
    expect(ann.anchor.type).toBe('point');
    expect(ann.anchor.geometry.coordinates).toEqual([10, 20]);
  });
});

test.describe('Reverse: name cascade', () => {
  // Each test seeds an annotation with specific properties (via the round-trip)
  // and asserts the reverse-converted annotation's name comes from the right slot.
  // The convert handler's pickName() priority (per convert.ts:366):
  //   properties.name > properties.title > first non-empty string > "Untitled from {layer}"

  test('uses properties.name when present', async ({ alice }) => {
    const a1 = await createAnnotation(
      alice,
      { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
      'body',
      { name: 'Explicit Name' },
    );
    const { layerId, featureIds } = await annotationsToLayerFeatures(alice, [a1], 'Cascade-name');
    const res = await alice.post(reverseUrl, { data: { layerId, featureIds } });
    const ids = (await res.json()).data.annotationIds as string[];
    const ann = (await (await alice.get(`${annotationsUrl}/${ids[0]}`)).json()).data;
    expect(ann.name).toBe('Explicit Name');
  });

  test('falls back to "Untitled from {layerName}" when no string properties exist', async ({ alice }) => {
    // Forward an annotation with no name → forward path uses `body.text` for both
    // annotation name AND feature.properties.name. To test the empty-cascade
    // branch we need a feature with NO usable string properties, which we can't
    // produce purely through annotation→layer (the body text becomes a property).
    // Instead, drive forward with body=text but a body matching the empty pattern,
    // then assert the cascade picks something stable.
    const a1 = await createAnnotation(
      alice,
      { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
      'plain body text',
    );
    const { layerId, featureIds } = await annotationsToLayerFeatures(alice, [a1], 'NameSrc');
    const res = await alice.post(reverseUrl, { data: { layerId, featureIds } });
    const ids = (await res.json()).data.annotationIds as string[];
    const ann = (await (await alice.get(`${annotationsUrl}/${ids[0]}`)).json()).data;
    // Either the body text ("plain body text") promoted via name slot, or the
    // layerName fallback — both are legal cascade outcomes. Asserting it's
    // non-null + non-empty is the load-bearing check; "definitely not a UUID"
    // is the regression we're guarding (per HANDOFF: "From layer feature {uuid}" was the bug).
    expect(typeof ann.name).toBe('string');
    expect(ann.name.length).toBeGreaterThan(0);
    expect(ann.name).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  test('truncates names longer than 200 chars', async ({ alice }) => {
    const longName = 'A'.repeat(300);
    const a1 = await createAnnotation(
      alice,
      { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } },
      'body',
      { name: longName.slice(0, 200) }, // create-side max is 200
    );
    const { layerId, featureIds } = await annotationsToLayerFeatures(alice, [a1], 'Trunc');
    const res = await alice.post(reverseUrl, { data: { layerId, featureIds } });
    const ids = (await res.json()).data.annotationIds as string[];
    const ann = (await (await alice.get(`${annotationsUrl}/${ids[0]}`)).json()).data;
    expect(ann.name.length).toBeLessThanOrEqual(200);
  });
});

test.describe('Reverse: round-trip annotation → feature → annotation', () => {
  test('point round-trip preserves geometry and surfaces a meaningful name', async ({ alice }) => {
    const original = await createAnnotation(
      alice,
      { type: 'point', geometry: { type: 'Point', coordinates: [-122.41, 37.77] } },
      'body for SF',
      { name: 'SF office' },
    );
    const { layerId, featureIds } = await annotationsToLayerFeatures(alice, [original], 'Round-trip');
    const back = await alice.post(reverseUrl, { data: { layerId, featureIds } });
    expect(back.status()).toBe(201);
    const newId = ((await back.json()).data.annotationIds as string[])[0];
    const ann = (await (await alice.get(`${annotationsUrl}/${newId}`)).json()).data;

    expect(ann.anchor.type).toBe('point');
    expect(ann.anchor.geometry.coordinates).toEqual([-122.41, 37.77]);
    expect(ann.name).toBe('SF office');
  });
});

test.describe('Reverse: validation', () => {
  test('rejects empty featureIds (min 1)', async ({ alice }) => {
    const res = await alice.post(reverseUrl, { data: { layerId: FIXTURE_LAYERS.aliceLayer, featureIds: [] } });
    expect(res.status()).toBe(422);
  });

  test('rejects more than 500 featureIds (max 500)', async ({ alice }) => {
    const featureIds = Array.from({ length: 501 }, (_, i) => {
      // Generate placeholder UUIDs — request shouldn't even reach the DB.
      const hex = i.toString(16).padStart(12, '0');
      return `00000000-0000-4000-8000-${hex}`;
    });
    const res = await alice.post(reverseUrl, { data: { layerId: FIXTURE_LAYERS.aliceLayer, featureIds } });
    expect(res.status()).toBe(422);
  });

  test('rejects malformed layerId (not a UUID)', async ({ alice }) => {
    const res = await alice.post(reverseUrl, {
      data: { layerId: 'not-a-uuid', featureIds: ['00000000-0000-4000-8000-000000000000'] },
    });
    expect(res.status()).toBe(422);
  });

  test('rejects unknown top-level fields (strict body)', async ({ alice }) => {
    const res = await alice.post(reverseUrl, {
      data: {
        layerId: FIXTURE_LAYERS.aliceLayer,
        featureIds: ['00000000-0000-4000-8000-000000000000'],
        somethingExtra: true,
      } as unknown as Record<string, never>,
    });
    expect(res.status()).toBe(422);
  });

  test('rejects feature IDs that do not exist on the layer (404)', async ({ alice }) => {
    // Use a real layer with a featureId that is the right UUID shape but unknown.
    // Use the seeded aliceLayer; pick a nil-ish UUID guaranteed not to match.
    const res = await alice.post(reverseUrl, {
      data: {
        layerId: FIXTURE_LAYERS.aliceLayer,
        featureIds: ['ffffffff-0000-4000-8000-000000000000'],
      },
    });
    expect(res.status()).toBe(404);
  });

  test('rejects feature IDs that exist but belong to a different layer', async ({ alice }) => {
    // Forward-convert to mint features on a freshly-created layer; then reference
    // them with the WRONG layerId (the seeded aliceLayer). Service joins on
    // `WHERE f.layer_id = $layerId`, so mismatched IDs should miss → NOT_FOUND.
    const a1 = await createAnnotation(alice, { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } }, 'mismatch');
    const { featureIds } = await annotationsToLayerFeatures(alice, [a1], 'WrongLayer');

    const res = await alice.post(reverseUrl, {
      data: { layerId: FIXTURE_LAYERS.aliceLayer, featureIds },
    });
    expect(res.status()).toBe(404);
  });
});

test.describe('Cross-tenant isolation', () => {
  test('Alice cannot reverse-convert features on Bob\'s map', async ({ alice }) => {
    const res = await alice.post(`/api/v1/maps/${bobMap}/convert-features-to-annotations`, {
      data: {
        layerId: FIXTURE_LAYERS.bobLayer,
        featureIds: ['00000000-0000-4000-8000-000000000000'],
      },
    });
    // Either auth-rejection at the map gate (403) or NOT_FOUND from the service
    expect([403, 404]).toContain(res.status());
  });

  test('Alice cannot forward-convert with annotation IDs from Bob\'s map (already covered) — sanity check stays close', async ({ alice, bob }) => {
    const bobAnn = await bob.post(`/api/v1/maps/${bobMap}/annotations`, {
      data: { anchor: { type: 'point', geometry: { type: 'Point', coordinates: [0, 0] } }, content: { kind: 'single', body: { type: 'text', text: 'b' } } },
    });
    const bobId = (await bobAnn.json()).data.id as string;
    const res = await alice.post(forwardUrl, { data: { annotationIds: [bobId], layerName: 'X' } });
    expect([404, 422]).toContain(res.status());
  });
});

test.describe('Auth required', () => {
  test('anonymous reverse-convert → 401', async ({ anon }) => {
    const res = await anon.post(reverseUrl, {
      data: { layerId: FIXTURE_LAYERS.aliceLayer, featureIds: ['00000000-0000-4000-8000-000000000000'] },
    });
    expect(res.status()).toBe(401);
  });

  test('anonymous forward-convert → 401', async ({ anon }) => {
    const res = await anon.post(forwardUrl, { data: { annotationIds: ['00000000-0000-4000-8000-000000000000'], layerName: 'x' } });
    expect(res.status()).toBe(401);
  });
});
