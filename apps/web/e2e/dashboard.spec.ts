import { demoTest as test, expect } from './fixtures/auth.js';

test.describe('Dashboard', () => {
  test('create map and verify it appears', async ({ demoPage: page }) => {
    await page.getByRole('button', { name: '+ New Map' }).click();
    await page.getByPlaceholder('Map title\u2026').fill('E2E Test Map');
    await page.getByRole('button', { name: 'Create' }).click();

    // Should redirect to the map editor
    await page.waitForURL(/\/map\//);
    await expect(page).toHaveURL(/\/map\//);
  });

  test('empty title defaults to Untitled Map', async ({ demoPage: page }) => {
    await page.getByRole('button', { name: '+ New Map' }).click();
    // Leave title empty and submit
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForURL(/\/map\//);
    await expect(page).toHaveURL(/\/map\//);

    // Verify the map toolbar displays "Untitled Map" as the title
    await expect(page.getByText('Untitled Map')).toBeVisible({ timeout: 10_000 });
  });

  test('handles special characters in map title', async ({ demoPage: page }) => {
    const xssTitle = '<script>alert(1)</script>';
    await page.getByRole('button', { name: '+ New Map' }).click();
    await page.getByPlaceholder('Map title\u2026').fill(xssTitle);
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForURL(/\/map\//);

    // The title should render as escaped text, not execute as HTML
    await expect(page.getByText(xssTitle)).toBeVisible({ timeout: 10_000 });

    // Verify no script tags were injected into the DOM
    const scriptCount = await page.locator('script').filter({ hasText: 'alert' }).count();
    expect(scriptCount).toBe(0);
  });
});
