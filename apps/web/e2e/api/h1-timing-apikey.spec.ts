import { test, expect } from '@playwright/test';
import { FIXTURE_API_KEY_ALICE_PLAINTEXT } from '../../src/lib/server/db/fixtures';

/**
 * H1 regression — API-key resolution via prefix + timingSafeEqual.
 *
 * The old path used `WHERE key_hash = $1` which leaked short-circuit timing
 * through the B-tree comparison. Post-fix, api-key.ts fetches by the public
 * `prefix` column and uses crypto.timingSafeEqual to compare the stored hash.
 *
 * We can't reliably assert wall-clock timing delta in CI (network + JIT
 * noise). Instead, assert functional correctness across the edge cases the
 * new code path must handle: valid key, valid-prefix-wrong-suffix, malformed
 * length, wrong scheme. A passing valid-key case proves the new compare path
 * works; the failing cases prove it fails closed.
 */

test.describe('H1: API key auth edge cases', () => {
  const base = { baseURL: 'http://localhost:5173' };

  test('valid key → 200', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      ...base,
      extraHTTPHeaders: { Authorization: `Bearer ${FIXTURE_API_KEY_ALICE_PLAINTEXT}` },
    });
    const res = await ctx.get('/api/v1/maps');
    expect(res.status()).toBe(200);
    await ctx.dispose();
  });

  test('valid prefix + wrong suffix → 401 (not timing-leaking match)', async ({ playwright }) => {
    // First 12 chars match alice; remaining 56 chars are zeros.
    const forged = FIXTURE_API_KEY_ALICE_PLAINTEXT.slice(0, 12) + '0'.repeat(56);
    const ctx = await playwright.request.newContext({
      ...base,
      extraHTTPHeaders: { Authorization: `Bearer ${forged}` },
    });
    const res = await ctx.get('/api/v1/maps');
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('random 68-char key → 401', async ({ playwright }) => {
    const random = 'flk_' + 'z'.repeat(64);
    const ctx = await playwright.request.newContext({
      ...base,
      extraHTTPHeaders: { Authorization: `Bearer ${random}` },
    });
    const res = await ctx.get('/api/v1/maps');
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('wrong length (too short) → 401', async ({ playwright }) => {
    const short = 'flk_tooshort';
    const ctx = await playwright.request.newContext({
      ...base,
      extraHTTPHeaders: { Authorization: `Bearer ${short}` },
    });
    const res = await ctx.get('/api/v1/maps');
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('wrong length (too long) → 401', async ({ playwright }) => {
    const tooLong = FIXTURE_API_KEY_ALICE_PLAINTEXT + 'extra';
    const ctx = await playwright.request.newContext({
      ...base,
      extraHTTPHeaders: { Authorization: `Bearer ${tooLong}` },
    });
    const res = await ctx.get('/api/v1/maps');
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });

  test('Bearer without flk_ scheme → 401', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      ...base,
      extraHTTPHeaders: { Authorization: 'Bearer notaflk_token' },
    });
    const res = await ctx.get('/api/v1/maps');
    expect(res.status()).toBe(401);
    await ctx.dispose();
  });
});
