import { demoTest as test, expect } from './fixtures/auth.js';
import { SF_LANDMARKS } from './fixtures/test-data.js';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

test.describe('Import / Export', () => {
  test('import GeoJSON file creates a layer with expected features', async ({ demoPage: page }) => {
    // Create a new map
    await page.getByRole('button', { name: '+ New Map' }).click();
    await page.getByPlaceholder('Map title\u2026').fill('Import Test');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForURL(/\/map\//);

    // Write test GeoJSON to a temp file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, 'e2e-landmarks.geojson');
    fs.writeFileSync(tmpFile, JSON.stringify(SF_LANDMARKS));

    // Upload via the hidden file input
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles(tmpFile);

    // Wait for the import to complete -- the layer name should appear in the layer panel
    const layerPanel = page.locator('.w-56');
    await expect(layerPanel.getByText('e2e-landmarks')).toBeVisible({ timeout: 30_000 });

    // Clean up
    fs.unlinkSync(tmpFile);
  });

  test('export GeoJSON downloads valid data via authenticated request', async ({ demoPage: page }) => {
    // Navigate to the seeded map
    await page.getByText('San Francisco Parks').click();
    await page.waitForURL(/\/map\//);

    // Get layer ID by fetching layers via tRPC
    const mapUrl = page.url();
    const mapId = mapUrl.split('/map/')[1]?.split('?')[0] ?? '';
    expect(mapId).toBeTruthy();

    const layersResponse = await page.request.post('/api/trpc/layers.list', {
      data: { json: { mapId } },
      headers: { 'content-type': 'application/json' },
    });
    expect(layersResponse.ok()).toBe(true);

    const layersBody = await layersResponse.json() as {
      result: { data: { json: Array<{ id: string; name: string }> } };
    };
    const layers = layersBody.result.data.json;
    expect(layers.length).toBeGreaterThan(0);

    const layerId = layers[0]!.id;

    // Use page.request (inherits auth cookies) to download the export
    const exportResponse = await page.request.get(`/api/export/${layerId}?format=geojson`);
    expect(exportResponse.ok()).toBe(true);
    expect(exportResponse.headers()['content-type']).toContain('geo+json');

    const body = await exportResponse.json() as { type: string; features: unknown[] };
    expect(body.type).toBe('FeatureCollection');
    expect(body.features.length).toBeGreaterThan(0);
  });

  test('rejects invalid GeoJSON file with error toast', async ({ demoPage: page }) => {
    // Create a new map
    await page.getByRole('button', { name: '+ New Map' }).click();
    await page.getByPlaceholder('Map title\u2026').fill('Bad Import Test');
    await page.getByRole('button', { name: 'Create' }).click();
    await page.waitForURL(/\/map\//);

    // Write invalid content to a .geojson file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, 'e2e-invalid.geojson');
    fs.writeFileSync(tmpFile, '{ this is not valid json!!!');

    // Upload via the hidden file input
    const fileInput = page.locator('#file-input');
    await fileInput.setInputFiles(tmpFile);

    // The import should fail -- expect an error toast
    await expect(page.getByRole('alert').filter({ hasText: /fail|error|invalid/i })).toBeVisible({
      timeout: 30_000,
    });

    // Clean up
    fs.unlinkSync(tmpFile);
  });
});
