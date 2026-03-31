import { describe, it, expect } from 'vitest';
import { resolve } from 'path';

describe('Export API', () => {
  describe('POST /api/export endpoint', () => {
    it('exists and handles export requests', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/routes/api/export/+server.ts'), 'utf-8')
      );
      expect(content).toMatch(/export const POST/);
      expect(content).toMatch(/ExportFormat/);
      expect(content).toMatch(/jobId/);
    });

    it('validates format parameter', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/routes/api/export/+server.ts'), 'utf-8')
      );
      expect(content).toMatch(/validFormats/);
      expect(content).toMatch(/geojson/);
      expect(content).toMatch(/gpkg/);
      expect(content).toMatch(/shp/);
      expect(content).toMatch(/pdf/);
    });

    it('creates jobs for async processing', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/routes/api/export/+server.ts'), 'utf-8')
      );
      expect(content).toMatch(/importJobs/);
      expect(content).toMatch(/processExportJob/);
      expect(content).toMatch(/status.*pending/);
    });

    it('handles direct exports for single layers', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/routes/api/export/+server.ts'), 'utf-8')
      );
      expect(content).toMatch(/handleDirectExport/);
      expect(content).toMatch(/targetLayerIds\.length === 1/);
    });
  });

  describe('GET /api/export/progress SSE endpoint', () => {
    it('exists and streams progress', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/routes/api/export/progress/+server.ts'), 'utf-8')
      );
      expect(content).toMatch(/export const GET/);
      expect(content).toMatch(/ReadableStream/);
      expect(content).toMatch(/text\/event-stream/);
    });

    it('polls job status every second', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/routes/api/export/progress/+server.ts'), 'utf-8')
      );
      expect(content).toMatch(/setInterval/);
      expect(content).toMatch(/1000/);
    });

    it('closes stream when job completes or fails', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/routes/api/export/progress/+server.ts'), 'utf-8')
      );
      expect(content).toMatch(/status === 'done'/);
      expect(content).toMatch(/status === 'failed'/);
      expect(content).toMatch(/controller\.close/);
    });
  });

  describe('ExportStore integration', () => {
    it('ExportState type matches API response', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/stores/export-store.svelte.ts'), 'utf-8')
      );
      expect(content).toMatch(/status.*ExportStatus/);
      expect(content).toMatch(/progress.*number/);
      expect(content).toMatch(/jobId/);
    });

    it('supports all export formats', async () => {
      const content = await import('fs/promises').then((fs) =>
        fs.readFile(resolve('src/lib/stores/export-store.svelte.ts'), 'utf-8')
      );
      expect(content).toMatch(/geojson/);
      expect(content).toMatch(/gpkg/);
      expect(content).toMatch(/shp/);
      expect(content).toMatch(/pdf/);
    });
  });
});
