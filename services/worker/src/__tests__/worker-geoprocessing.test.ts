/**
 * Characterization test: verifies that the existing worker still exports
 * the import job processor and that the geoprocessing handler is present.
 *
 * After F08 async geoprocessing: worker has two BullMQ workers —
 * 'file-import' (existing) and 'geoprocessing' (new).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies before importing worker
vi.mock('pg', () => ({
  default: {
    Pool: vi.fn(() => ({
      query: vi.fn().mockResolvedValue({ rows: [] }),
      end: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

vi.mock('drizzle-orm/node-postgres', () => ({
  drizzle: vi.fn(() => ({ execute: vi.fn().mockResolvedValue({ rows: [] }) })),
}));

vi.mock('ioredis', () => ({
  Redis: vi.fn(() => ({ quit: vi.fn() })),
}));

let capturedProcessors: Record<string, (job: unknown) => Promise<void>> = {};

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation((name: string, processor: (job: unknown) => Promise<void>) => {
    capturedProcessors[name] = processor;
    return { on: vi.fn(), close: vi.fn() };
  }),
}));

vi.mock('@felt-like-it/import-engine', () => ({
  parseGeoJSON: vi.fn(),
  parseCSV: vi.fn(),
  csvRowsToFeatures: vi.fn(),
  parseShapefile: vi.fn(),
  parseKML: vi.fn(),
  parseGPX: vi.fn(),
  parseGeoPackage: vi.fn(),
}));

vi.mock('@felt-like-it/geo-engine', () => ({
  detectLayerType: vi.fn().mockReturnValue('point'),
  generateAutoStyle: vi.fn().mockReturnValue({ color: '#000' }),
  detectCoordinateColumns: vi.fn(),
  detectAddressColumn: vi.fn(),
  geocodeBatch: vi.fn(),
}));

vi.mock('../logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

beforeEach(async () => {
  vi.resetModules();
  capturedProcessors = {};
  await import('../../src/index.js');
});

describe('worker exports', () => {
  it('worker file exists and is importable', () => {
    expect(true).toBe(true);
  });

  it('registers both file-import and geoprocessing queue workers', () => {
    expect(capturedProcessors['file-import']).toBeDefined();
    expect(capturedProcessors['geoprocessing']).toBeDefined();
  });

  it('geoprocessing processor rejects invalid payload', async () => {
    const processor = capturedProcessors['geoprocessing'];
    expect(processor).toBeDefined();

    // Missing required fields should throw Zod validation error
    await expect(processor!({ data: {}, id: 'test-job' })).rejects.toThrow();
  });

  it('geoprocessing processor accepts valid geoprocessing payload shape', async () => {
    const processor = capturedProcessors['geoprocessing'];
    expect(processor).toBeDefined();

    const validGeoPayload = {
      jobId: '00000000-0000-0000-0000-000000000001',
      mapId: '00000000-0000-0000-0000-000000000002',
      op: { type: 'buffer', layerId: '00000000-0000-0000-0000-000000000010', distanceKm: 1 },
      outputLayerId: '00000000-0000-0000-0000-000000000003',
    };

    // Should not throw on validation (will fail on DB execution, but that's mocked)
    await expect(processor!({ data: validGeoPayload, id: 'test-job' })).resolves.not.toThrow(
      /Invalid.*payload/i
    );
  });
});
