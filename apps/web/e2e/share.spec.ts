import { test, expect } from '@playwright/test';

test.describe('Share', () => {
  test('shared map is viewable anonymously and hides edit controls', async ({ page }) => {
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
      const browser = page.context().browser();
      if (!browser) throw new Error('Browser not available');
      const anonContext = await browser.newContext();
      const anonPage = await anonContext.newPage();
      await anonPage.goto(`/share/${token}`);

      // Should show the map (canvas visible)
      await expect(anonPage.locator('canvas')).toBeVisible({ timeout: 15_000 });

      // The share page passes readonly=true -- edit tools must not be visible
      await expect(anonPage.getByRole('button', { name: 'Import' })).not.toBeVisible();
      await expect(anonPage.getByRole('button', { name: 'Export' })).not.toBeVisible();
      await expect(anonPage.getByRole('button', { name: 'Table' })).not.toBeVisible();

      // The layer panel (w-56 sidebar) should not be present in readonly mode
      await expect(anonPage.locator('.w-56')).not.toBeAttached();

      await anonContext.close();
    }
  });

  test('shows error for invalid share token', async ({ page }) => {
    const response = await page.goto('/share/invalid-token-that-does-not-exist');

    // The server returns 404 for unknown share tokens
    expect(response?.status()).toBe(404);
  });
});
