import { demoTest as test, expect } from './fixtures/auth.js';

test.describe('Map Editor', () => {
  test('toolbar and layer panel are visible', async ({ demoPage: page }) => {
    // Navigate to the seeded "San Francisco Parks" map
    await page.getByText('San Francisco Parks').click();
    await page.waitForURL(/\/map\//);

    // The map editor should have a toolbar and layer panel
    // Wait for the map to load (MapLibre canvas appears)
    await expect(page.locator('canvas')).toBeVisible({ timeout: 15_000 });
  });

  test('layer panel shows the Parks layer', async ({ demoPage: page }) => {
    await page.getByText('San Francisco Parks').click();
    await page.waitForURL(/\/map\//);

    // The seeded map has a "Parks" layer
    await expect(page.getByText('Parks')).toBeVisible({ timeout: 10_000 });
  });
});
