// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { drizzleChain } from './test-utils.js';

vi.mock('$lib/server/db/index.js', () => ({
  db: { insert: vi.fn(), update: vi.fn() },
  layers: { id: {} },
  importJobs: { id: {} },
}));

vi.mock('$lib/server/geo/queries.js', () => ({
  insertFeatures: vi.fn(),
  getLayerBbox: vi.fn(),
}));

vi.mock('@felt-like-it/geo-engine', () => ({
  detectLayerType: vi.fn(() => 'point'),
  generateAutoStyle: vi.fn(() => ({ paint: {} })),
}));

import { createLayerAndInsertFeatures } from '$lib/server/import/shared.js';
import { db } from '$lib/server/db/index.js';
import { insertFeatures, getLayerBbox } from '$lib/server/geo/queries.js';

describe('createLayerAndInsertFeatures', () => {
  beforeEach(() => vi.resetAllMocks());

  it('creates layer, batch-inserts features, and returns result', async () => {
    const LAYER_ID = 'layer-1';
    vi.mocked(db.insert).mockReturnValue(drizzleChain([{ id: LAYER_ID }]));
    vi.mocked(db.update).mockReturnValue(drizzleChain(undefined));
    vi.mocked(insertFeatures).mockResolvedValue(undefined);
    vi.mocked(getLayerBbox).mockResolvedValue([-122, 37, -121, 38]);

    const features = Array.from({ length: 3 }, (_, i) => ({
      geometry: { type: 'Point' as const, coordinates: [-122 + i, 37] as [number, number] },
      properties: { name: `f${i}` },
    }));

    const result = await createLayerAndInsertFeatures({
      mapId: 'map-1',
      jobId: 'job-1',
      layerName: 'Test Layer',
      features,
    });

    expect(result.layerId).toBe(LAYER_ID);
    expect(result.featureCount).toBe(3);
    expect(result.bbox).toEqual([-122, 37, -121, 38]);
    expect(insertFeatures).toHaveBeenCalledOnce();
  });

  it('rejects when layer creation returns empty', async () => {
    vi.mocked(db.insert).mockReturnValue(drizzleChain([]));

    await expect(
      createLayerAndInsertFeatures({
        mapId: 'map-1',
        jobId: 'job-1',
        layerName: 'Bad',
        features: [{ geometry: { type: 'Point', coordinates: [0, 0] as [number, number] }, properties: {} }],
      })
    ).rejects.toThrow('Failed to create layer');
  });

  it('uses layerTypeOverride when provided instead of auto-detecting', async () => {
    vi.mocked(db.insert).mockReturnValue(drizzleChain([{ id: 'layer-2' }]));
    vi.mocked(db.update).mockReturnValue(drizzleChain(undefined));
    vi.mocked(insertFeatures).mockResolvedValue(undefined);
    vi.mocked(getLayerBbox).mockResolvedValue(null);

    const { detectLayerType } = await import('@felt-like-it/geo-engine');

    const result = await createLayerAndInsertFeatures({
      mapId: 'map-1',
      jobId: 'job-1',
      layerName: 'CSV Layer',
      features: [{ geometry: { type: 'Point', coordinates: [0, 0] as [number, number] }, properties: {} }],
      layerTypeOverride: 'point',
    });

    expect(result.layerId).toBe('layer-2');
    expect(result.bbox).toBeNull();
    expect(detectLayerType).not.toHaveBeenCalled();
  });

  it('batches features in groups of 500', async () => {
    vi.mocked(db.insert).mockReturnValue(drizzleChain([{ id: 'layer-3' }]));
    vi.mocked(db.update).mockReturnValue(drizzleChain(undefined));
    vi.mocked(insertFeatures).mockResolvedValue(undefined);
    vi.mocked(getLayerBbox).mockResolvedValue(null);

    const features = Array.from({ length: 1200 }, (_, i) => ({
      geometry: { type: 'Point' as const, coordinates: [i, 0] as [number, number] },
      properties: { idx: i },
    }));

    await createLayerAndInsertFeatures({
      mapId: 'map-1',
      jobId: 'job-1',
      layerName: 'Big Layer',
      features,
    });

    // 1200 features / 500 batch = 3 batches (500 + 500 + 200)
    expect(insertFeatures).toHaveBeenCalledTimes(3);
  });
});
