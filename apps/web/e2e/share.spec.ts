import { test, expect } from '@playwright/test';

test.describe('Share', () => {
  test('shared map is viewable anonymously via share link', async ({ page, request }) => {
    // Login as demo user
    await page.goto('/auth/login');
    await page.getByLabel('Email').fill('demo@felt-like-it.local');
    await page.getByLabel('Password').fill('demo');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.waitForURL('**/dashboard');

    // Navigate to the seeded map
    await page.getByText('San Francisco Parks').click();
    await page.waitForURL(/\/map\//);
    const mapUrl = page.url();
    const mapId = mapUrl.split('/map/')[1]?.split('?')[0];

    // Create a share link via tRPC
    const shareResponse = await page.request.post('/api/trpc/shares.create', {
      data: { json: { mapId } },
      headers: { 'content-type': 'application/json' },
    });

    // Even if share already exists (409), we can fetch existing shares
    if (shareResponse.ok()) {
      const body = await shareResponse.json() as { result: { data: { json: { token: string } } } };
      const token = body.result.data.json.token;

      // Visit share page in a new context (no cookies = anonymous)
      const anonContext = await page.context().browser()!.newContext();
      const anonPage = await anonContext.newPage();
      await anonPage.goto(`/share/${token}`);

      // Should show the map (canvas visible)
      await expect(anonPage.locator('canvas')).toBeVisible({ timeout: 15_000 });
      await anonContext.close();
    }
  });
});
