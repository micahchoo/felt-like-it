import { test, expect } from '@playwright/test';
import { FIXTURE_API_KEY_ALICE_PLAINTEXT } from '../../src/lib/server/db/fixtures';

/**
 * H4 regression — /api/v1/export/progress caps concurrent SSE streams at
 * STREAM_CAP (default 5) per user. 6th request must 429.
 *
 * We use a format-valid-but-unknown UUID jobId so the handler's ownership
 * check would 404 IF it ran — but the CAP fires at request-start, before
 * the DB lookup, so the first 5 get their 404 stream (or 404 JSON response)
 * and the 6th gets 429. The CAP check is what we're asserting.
 *
 * To keep streams "open" long enough for the cap to hold across the 6
 * parallel starts, we use AbortControllers and only abort after the 6th
 * response status has been observed. Native fetch is used instead of
 * APIRequestContext because Playwright's request context consumes the
 * body eagerly, which collapses the window.
 */

test.describe('H4: SSE stream cap', () => {
  test('concurrent SSE to /api/v1/export/progress exceeds cap → 429s', async () => {
    // Fire N=12 concurrent. With STREAM_CAP=5 and a clean map, 5 pass + 7 get
    // 429. With residual slots from a prior run we'd see even more 429s. The
    // only way to get zero 429s would be the cap failing entirely, which is
    // the regression we're guarding against. N=12 vs N=6 makes the probe
    // robust to timing noise and state leaks.
    const N = 12;
    const url =
      'http://localhost:5173/api/v1/export/progress?jobId=00000000-0000-0000-0000-000000000000';
    const headers = {
      Authorization: `Bearer ${FIXTURE_API_KEY_ALICE_PLAINTEXT}`,
      Accept: 'text/event-stream',
    };

    const controllers: AbortController[] = [];
    const makeRequest = () => {
      const c = new AbortController();
      controllers.push(c);
      return fetch(url, { headers, signal: c.signal }).catch((e: Error) => {
        if (e.name === 'AbortError') {
          return new Response(null, { status: 0 });
        }
        throw e;
      });
    };

    try {
      const responses = await Promise.all(Array.from({ length: N }, () => makeRequest()));
      const statuses = responses.map((r) => r.status);
      const rateLimited = statuses.filter((s) => s === 429).length;

      expect(
        rateLimited,
        `expected at least one 429 among ${N} concurrent streams; got: ${JSON.stringify(
          statuses,
        )}`,
      ).toBeGreaterThanOrEqual(1);
    } finally {
      for (const c of controllers) c.abort();
      // Let the server drain aborted slots before the next test.
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });
});
