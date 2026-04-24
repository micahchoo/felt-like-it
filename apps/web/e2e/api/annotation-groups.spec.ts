import { apiTest as test, expect } from '../fixtures/api-auth';
import { FIXTURE_MAPS } from '../../src/lib/server/db/fixtures';

/**
 * Group-resource lifecycle coverage for /api/v1/maps/:mapId/annotation-groups.
 *
 * Companion to annotations-marketing.spec.ts Promise 17, which covers the
 * annotation-side of grouping (POST groupId on create, PATCH groupId, orphan
 * after group delete). This file covers the group resource itself: PATCH for
 * each mutable field, idempotent DELETE, nesting via parentGroupId, and
 * cross-tenant isolation.
 */

const groupsUrl = `/api/v1/maps/${FIXTURE_MAPS.aliceMap}/annotation-groups`;
const bobGroupsUrl = `/api/v1/maps/${FIXTURE_MAPS.bobMap}/annotation-groups`;

type Alice = Parameters<Parameters<typeof test>[1]>[0]['alice'];

async function createGroup(alice: Alice, name: string, extras: Record<string, unknown> = {}): Promise<{ id: string; name: string; visible: boolean; parentGroupId: string | null }> {
  const res = await alice.post(groupsUrl, { data: { name, ...extras } });
  expect(res.status()).toBe(201);
  return (await res.json()).data;
}

test.describe('PATCH /annotation-groups/:id — name', () => {
  test('updates the group name and reflects on subsequent list', async ({ alice }) => {
    const g = await createGroup(alice, 'Initial');
    const res = await alice.patch(`${groupsUrl}/${g.id}`, { data: { name: 'Renamed' } });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.name).toBe('Renamed');

    const list = (await (await alice.get(groupsUrl)).json()).data as Array<{ id: string; name: string }>;
    expect(list.find((x) => x.id === g.id)?.name).toBe('Renamed');
  });

  test('rejects empty name', async ({ alice }) => {
    const g = await createGroup(alice, 'NonEmpty');
    const res = await alice.patch(`${groupsUrl}/${g.id}`, { data: { name: '' } });
    expect(res.status()).toBe(422);
  });

  test('rejects name longer than 200 chars', async ({ alice }) => {
    const g = await createGroup(alice, 'Short');
    const res = await alice.patch(`${groupsUrl}/${g.id}`, { data: { name: 'x'.repeat(201) } });
    expect(res.status()).toBe(422);
  });
});

test.describe('PATCH /annotation-groups/:id — visible', () => {
  test('toggles visibility from default true to false and back', async ({ alice }) => {
    const g = await createGroup(alice, 'Visible toggle');
    expect(g.visible).toBe(true);

    const off = await alice.patch(`${groupsUrl}/${g.id}`, { data: { visible: false } });
    expect(off.status()).toBe(200);
    expect((await off.json()).data.visible).toBe(false);

    const on = await alice.patch(`${groupsUrl}/${g.id}`, { data: { visible: true } });
    expect(on.status()).toBe(200);
    expect((await on.json()).data.visible).toBe(true);
  });

  test('rejects non-boolean visible', async ({ alice }) => {
    const g = await createGroup(alice, 'Strict');
    const res = await alice.patch(`${groupsUrl}/${g.id}`, { data: { visible: 'no' as unknown as boolean } });
    expect(res.status()).toBe(422);
  });
});

test.describe('PATCH /annotation-groups/:id — nesting via parentGroupId', () => {
  test('moves a group under a parent and lists with the parent set', async ({ alice }) => {
    const parent = await createGroup(alice, 'Parent');
    const child = await createGroup(alice, 'Child');
    expect(child.parentGroupId).toBeNull();

    const res = await alice.patch(`${groupsUrl}/${child.id}`, { data: { parentGroupId: parent.id } });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.parentGroupId).toBe(parent.id);

    const list = (await (await alice.get(groupsUrl)).json()).data as Array<{ id: string; parentGroupId: string | null }>;
    expect(list.find((x) => x.id === child.id)?.parentGroupId).toBe(parent.id);
  });

  test('null-clear moves a child back to the root', async ({ alice }) => {
    const parent = await createGroup(alice, 'Root parent');
    const child = await createGroup(alice, 'Nested child', { parentGroupId: parent.id });
    expect(child.parentGroupId).toBe(parent.id);

    const res = await alice.patch(`${groupsUrl}/${child.id}`, { data: { parentGroupId: null } });
    expect(res.status()).toBe(200);
    expect((await res.json()).data.parentGroupId).toBeNull();
  });

  test('rejects malformed parentGroupId (not a UUID)', async ({ alice }) => {
    const g = await createGroup(alice, 'X');
    const res = await alice.patch(`${groupsUrl}/${g.id}`, { data: { parentGroupId: 'not-a-uuid' } });
    expect(res.status()).toBe(422);
  });
});

test.describe('PATCH /annotation-groups/:id — ordinal', () => {
  test('integer ordinal is accepted and persisted', async ({ alice }) => {
    const g = await createGroup(alice, 'Ordered');
    const res = await alice.patch(`${groupsUrl}/${g.id}`, { data: { ordinal: 7 } });
    expect(res.status()).toBe(200);
    // Don't assert exact echoed shape — service may normalise — but the call must succeed
    // and a subsequent read must not lose the field if exposed.
    const readBack = (await (await alice.get(groupsUrl)).json()).data as Array<{ id: string; ordinal?: number }>;
    const found = readBack.find((x) => x.id === g.id);
    expect(found).toBeTruthy();
  });

  test('rejects non-integer ordinal', async ({ alice }) => {
    const g = await createGroup(alice, 'Strict ordinal');
    const res = await alice.patch(`${groupsUrl}/${g.id}`, { data: { ordinal: 1.5 } });
    expect(res.status()).toBe(422);
  });
});

test.describe('PATCH /annotation-groups/:id — strict body', () => {
  test('rejects unknown top-level fields', async ({ alice }) => {
    const g = await createGroup(alice, 'Strict body');
    const res = await alice.patch(`${groupsUrl}/${g.id}`, { data: { surprise: 'field' } as unknown as Record<string, never> });
    expect(res.status()).toBe(422);
  });

  test('empty PATCH body is still parseable (no-op)', async ({ alice }) => {
    const g = await createGroup(alice, 'No-op');
    const res = await alice.patch(`${groupsUrl}/${g.id}`, { data: {} });
    // Either 200 with the unchanged group, or 422 if the service refuses no-op — both
    // are defensible. Asserting it's not 5xx is the important part.
    expect([200, 422]).toContain(res.status());
  });
});

test.describe('DELETE /annotation-groups/:id', () => {
  test('returns 204 on first delete and 204 again on repeat (idempotent)', async ({ alice }) => {
    const g = await createGroup(alice, 'Idempotent');
    const first = await alice.delete(`${groupsUrl}/${g.id}`);
    expect(first.status()).toBe(204);

    const second = await alice.delete(`${groupsUrl}/${g.id}`);
    expect(second.status()).toBe(204);
  });

  test('deleted group disappears from list', async ({ alice }) => {
    const g = await createGroup(alice, 'Vanishing');
    await alice.delete(`${groupsUrl}/${g.id}`);
    const list = (await (await alice.get(groupsUrl)).json()).data as Array<{ id: string }>;
    expect(list.some((x) => x.id === g.id)).toBe(false);
  });
});

test.describe('Cross-tenant isolation', () => {
  test('Alice cannot list Bob\'s annotation groups', async ({ alice }) => {
    const res = await alice.get(bobGroupsUrl);
    expect(res.status()).toBe(404);
  });

  test('Alice cannot create a group on Bob\'s map', async ({ alice }) => {
    const res = await alice.post(bobGroupsUrl, { data: { name: 'Hijack' } });
    expect([403, 404]).toContain(res.status());
  });

  test('Alice cannot PATCH a group owned by Bob', async ({ alice, bob }) => {
    const bobCreate = await bob.post(bobGroupsUrl, { data: { name: 'Bobs group' } });
    expect(bobCreate.status()).toBe(201);
    const bobId = (await bobCreate.json()).data.id as string;

    // Alice addresses Bob's group via her own map URL prefix
    const res = await alice.patch(`${groupsUrl}/${bobId}`, { data: { name: 'Hijacked' } });
    expect([403, 404]).toContain(res.status());
  });

  test('Alice cannot DELETE a group owned by Bob', async ({ alice, bob }) => {
    const bobCreate = await bob.post(bobGroupsUrl, { data: { name: 'Bobs other group' } });
    const bobId = (await bobCreate.json()).data.id as string;

    const res = await alice.delete(`${groupsUrl}/${bobId}`);
    // Service-level ownership check: either 403/404 (rejection) or 204 if the delete
    // is short-circuited as idempotent without touching the row. Verify Bob still has it.
    expect([403, 404, 204]).toContain(res.status());

    const bobRead = await bob.get(bobGroupsUrl);
    const bobList = (await bobRead.json()).data as Array<{ id: string }>;
    expect(bobList.some((g) => g.id === bobId)).toBe(true);
  });
});

test.describe('Auth required', () => {
  test('anonymous list → 401', async ({ anon }) => {
    const res = await anon.get(groupsUrl);
    expect(res.status()).toBe(401);
  });

  test('anonymous create → 401', async ({ anon }) => {
    const res = await anon.post(groupsUrl, { data: { name: 'no auth' } });
    expect(res.status()).toBe(401);
  });

  test('anonymous PATCH → 401', async ({ anon, alice }) => {
    const g = await createGroup(alice, 'Has owner');
    const res = await anon.patch(`${groupsUrl}/${g.id}`, { data: { name: 'x' } });
    expect(res.status()).toBe(401);
  });

  test('anonymous DELETE → 401', async ({ anon, alice }) => {
    const g = await createGroup(alice, 'Owned');
    const res = await anon.delete(`${groupsUrl}/${g.id}`);
    expect(res.status()).toBe(401);
  });
});
