import { demoTest as test, expect } from './fixtures/auth.js';

test.describe('Map Editor', () => {
  test('loads seed map with title visible in toolbar', async ({ demoPage: page }) => {
    // Navigate to the seeded "San Francisco Parks" map
    await page.getByText('San Francisco Parks').click();
    await page.waitForURL(/\/map\//);

    // The map editor should render the MapLibre canvas
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });

    // The map title should be visible in the toolbar area (top of the editor)
    await expect(page.getByText('San Francisco Parks').first()).toBeVisible();
  });

  test('displays Parks layer in the layer panel', async ({ demoPage: page }) => {
    await page.getByText('San Francisco Parks').click();
    await page.waitForURL(/\/map\//);

    // The seeded map has a "Parks" layer -- verify it appears in the
    // left-hand layer panel (the 56-wide sidebar), not just anywhere on the page.
    // The layer panel is the first child flex column; use a scoped locator.
    const layerPanel = page.locator('.w-56');
    await expect(layerPanel.getByText('Parks')).toBeVisible({ timeout: 10_000 });
  });

  test('shows 404 for non-existent map', async ({ demoPage: page }) => {
    const fakeMapId = '00000000-0000-0000-0000-000000000000';
    const response = await page.goto(`/map/${fakeMapId}`);

    // The server returns a 404 for maps that don't exist
    expect(response?.status()).toBe(404);
  });
});
