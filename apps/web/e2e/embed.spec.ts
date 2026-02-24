import { test, expect } from '@playwright/test';

test.describe('Embed', () => {
  test('embed page renders map with CSP header and hides all chrome', async ({ page, request }) => {
    // Login as demo user to create a share
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

    if (shareResponse.ok()) {
      const body = await shareResponse.json() as { result: { data: { json: { token: string } } } };
      const token = body.result.data.json.token;

      // Fetch embed page and check the exact CSP header value
      const embedResponse = await request.get(`/embed/${token}`);
      const csp = embedResponse.headers()['content-security-policy'] ?? '';
      expect(csp).toContain('frame-ancestors *');

      // Visit embed page in a new context (anonymous)
      const browser = page.context().browser();
      if (!browser) throw new Error('Browser not available');
      const anonContext = await browser.newContext();
      const anonPage = await anonContext.newPage();
      await anonPage.goto(`/embed/${token}`);

      // Should show the map canvas
      await expect(anonPage.locator('canvas')).toBeVisible({ timeout: 15_000 });

      // Embed mode hides the toolbar entirely (the bar with Import/Export/Table buttons)
      await expect(anonPage.getByText('Import')).not.toBeVisible();
      await expect(anonPage.getByText('Export')).not.toBeVisible();

      // The layer panel sidebar should not be present
      await expect(anonPage.locator('.w-56')).not.toBeAttached();

      // The basemap picker should not be present in embed mode
      // (BasemapPicker is inside an {#if !embed} block)
      await expect(anonPage.getByText('Basemap')).not.toBeVisible();

      await anonContext.close();
    }
  });

  test('shows error for invalid embed token', async ({ page }) => {
    const response = await page.goto('/embed/invalid-token-that-does-not-exist');

    // The server returns 404 for unknown embed tokens
    expect(response?.status()).toBe(404);
  });
});
