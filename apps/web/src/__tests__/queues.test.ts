import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$lib/server/jobs/connection', () => ({
  createRedisConnection: vi.fn(() => ({ connect: vi.fn(), quit: vi.fn() })),
}));

describe('queues.ts', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('getImportQueue returns a Queue with name file-import', async () => {
    const { getImportQueue } = await import('$lib/server/jobs/queues.js');
    const queue = getImportQueue();
    expect(queue.name).toBe('file-import');
  });

  it('getGeoprocessingQueue returns a Queue with name geoprocessing', async () => {
    const { getGeoprocessingQueue } = await import('$lib/server/jobs/queues.js');
    const queue = getGeoprocessingQueue();
    expect(queue.name).toBe('geoprocessing');
  });
});
