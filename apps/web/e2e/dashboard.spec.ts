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
  });
});
