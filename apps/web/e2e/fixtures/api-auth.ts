import { test as base, expect, type APIRequestContext } from '@playwright/test';

import {
  FIXTURE_API_KEY_ALICE_PLAINTEXT,
  FIXTURE_API_KEY_BOB_PLAINTEXT,
} from '../../src/lib/server/db/fixtures';

/**
 * The /api/v1/* surface authenticates via Bearer flk_... (or ?token=<share>).
 * Session cookies set by /auth/login are NOT honored for API routes — that's
 * a UI-only auth path. Adversarial probes use Bearer keys.
 */
async function bearerContext(
  playwright: { request: { newContext: (opts: { baseURL: string; extraHTTPHeaders: Record<string, string> }) => Promise<APIRequestContext> } },
  baseURL: string,
  apiKey: string,
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${apiKey}`,
      accept: 'application/json',
    },
  });
}

export interface ApiFixtures {
  alice: APIRequestContext;
  bob: APIRequestContext;
  /** No auth header — for 401 probes. */
  anon: APIRequestContext;
  /** Read-only share-token scoped to bobMap. Set ?token=<FIXTURE_SHARE_TOKEN_BOB> at call site. */
  shareClient: APIRequestContext;
}

export const apiTest = base.extend<ApiFixtures>({
  alice: async ({ playwright, baseURL }, use) => {
    if (!baseURL) throw new Error('baseURL must be configured on the api project');
    const ctx = await bearerContext(playwright, baseURL, FIXTURE_API_KEY_ALICE_PLAINTEXT);
    await use(ctx);
    await ctx.dispose();
  },
  bob: async ({ playwright, baseURL }, use) => {
    if (!baseURL) throw new Error('baseURL must be configured on the api project');
    const ctx = await bearerContext(playwright, baseURL, FIXTURE_API_KEY_BOB_PLAINTEXT);
    await use(ctx);
    await ctx.dispose();
  },
  anon: async ({ playwright, baseURL }, use) => {
    if (!baseURL) throw new Error('baseURL must be configured on the api project');
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { accept: 'application/json' } });
    await use(ctx);
    await ctx.dispose();
  },
  shareClient: async ({ playwright, baseURL }, use) => {
    if (!baseURL) throw new Error('baseURL must be configured on the api project');
    const ctx = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { accept: 'application/json' } });
    await use(ctx);
    await ctx.dispose();
  },
});

export { expect };
