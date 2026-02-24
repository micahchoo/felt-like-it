import { test, expect } from '@playwright/test';

test.describe('Embed', () => {
  test('embed page renders map and has CSP header', async ({ page, request }) => {
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

      // Fetch embed page and check CSP header
      const embedResponse = await request.get(`/embed/${token}`);
      const csp = embedResponse.headers()['content-security-policy'] ?? '';
      expect(csp).toContain('frame-ancestors');

      // Visit embed page in a new context
      const browser = page.context().browser();
      if (!browser) throw new Error('Browser not available');
      const anonContext = await browser.newContext();
      const anonPage = await anonContext.newPage();
      await anonPage.goto(`/embed/${token}`);

      // Should show the map canvas without toolbar
      await expect(anonPage.locator('canvas')).toBeVisible({ timeout: 15_000 });
      await anonContext.close();
    }
  });
});
