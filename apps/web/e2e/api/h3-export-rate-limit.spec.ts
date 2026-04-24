import { test, expect } from '@playwright/test';
import { FIXTURE_API_KEY_ALICE_PLAINTEXT } from '../../src/lib/server/db/fixtures';

/**
 * H3 regression — POST /api/v1/export must enforce the same per-user
 * rate limit every other /api/v1/* mutation enforces.
 *
 * The middleware limiter is sliding-1s window at API_KEY_LIMIT (default 100).
 * We fire 150 POSTs in a tight loop with an intentionally-invalid body so
 * the handler rejects early (no real job queued) while the rate-limit
 * check still runs at the top. At least one 429 must appear.
 *
 * Test runs in <2s; the 1s window self-clears.
 */

test.describe('H3: export POST rate limit', () => {
  test('150 rapid POSTs to /api/v1/export yield at least one 429', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({
      baseURL: 'http://localhost:5173',
      extraHTTPHeaders: {
        Authorization: `Bearer ${FIXTURE_API_KEY_ALICE_PLAINTEXT}`,
        'Content-Type': 'application/json',
      },
    });

    // Invalid body (missing format/layerIds) — 400s fast, but rate-limit
    // runs BEFORE the body validation, so every call increments.
    const fire = () =>
      ctx.post('/api/v1/export', {
        data: { nope: true },
        failOnStatusCode: false,
      });

    const attempts = 150;
    const responses = await Promise.all(
      Array.from({ length: attempts }, () => fire()),
    );
    const statuses = responses.map((r) => r.status());
    const rateLimited = statuses.filter((s) => s === 429).length;

    await ctx.dispose();

    expect(
      rateLimited,
      `expected at least one 429 among ${attempts} POSTs; got statuses: ${JSON.stringify(
        tally(statuses),
      )}`,
    ).toBeGreaterThanOrEqual(1);
  });
});

function tally(xs: number[]): Record<number, number> {
  const out: Record<number, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}
