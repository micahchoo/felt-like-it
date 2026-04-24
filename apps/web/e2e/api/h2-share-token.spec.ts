import { test, expect } from '@playwright/test';
import {
  FIXTURE_MAPS,
  FIXTURE_SHARE_TOKEN_BOB,
} from '../../src/lib/server/db/fixtures';

/**
 * H2 / L1 regression — share-token format guard + IP rate limit.
 *
 * The format guard (`/^[A-Za-z0-9_-]{32,64}$/`) rejects malformed tokens
 * without hitting the DB. The IP rate limiter (10/60 s, Redis-backed)
 * caps dictionary-attack throughput. Both are upstream of the token
 * lookup in `shares`.
 */

test.describe('H2: share-token hardening', () => {
  const base = { baseURL: 'http://localhost:5173' };

  test('valid fixture share token grants read access to bobMap', async ({ playwright }) => {
    const ctx = await playwright.request.newContext(base);
    const res = await ctx.get(
      `/api/v1/maps/${FIXTURE_MAPS.bobMap}?token=${FIXTURE_SHARE_TOKEN_BOB}`,
    );
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe(FIXTURE_MAPS.bobMap);
    await ctx.dispose();
  });

  test('share-token scoped to bobMap cannot read aliceMap', async ({ playwright }) => {
    const ctx = await playwright.request.newContext(base);
    const res = await ctx.get(
      `/api/v1/maps/${FIXTURE_MAPS.aliceMap}?token=${FIXTURE_SHARE_TOKEN_BOB}`,
    );
    expect([401, 403, 404]).toContain(res.status());
    await ctx.dispose();
  });

  test('malformed token (too short) → 401', async ({ playwright }) => {
    const ctx = await playwright.request.newContext(base);
    const res = await ctx.get(`/api/v1/maps/${FIXTURE_MAPS.bobMap}?token=short`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('malformed token (disallowed chars) → 401', async ({ playwright }) => {
    const ctx = await playwright.request.newContext(base);
    // Length is fine but contains `!` which violates the character class
    const bad = 'x'.repeat(31) + '!';
    const res = await ctx.get(`/api/v1/maps/${FIXTURE_MAPS.bobMap}?token=${bad}`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('valid-format but unknown token → 401 (DB miss)', async ({ playwright }) => {
    const ctx = await playwright.request.newContext(base);
    const unknown = 'x'.repeat(40);
    const res = await ctx.get(`/api/v1/maps/${FIXTURE_MAPS.bobMap}?token=${unknown}`);
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});
