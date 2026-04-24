// @vitest-environment node
/**
 * Characterization tests for the data pipeline code paths that will be modified.
 *
 * These tests capture CURRENT behavior before we change it:
 * - Upload endpoint: Buffer.from(await file.arrayBuffer()) → streaming
 * - Filter store: singleton per-layer API → FiltersStore class
 * - Geoprocessing router: sync runGeoprocessing → async job enqueue
 *
 * When these tests start FAILING, it means we've successfully changed the behavior.
 * They serve as a regression safety net — the NEW behavior should have its own tests.
 */

import { describe, it, expect } from 'vitest';

// ─── 1. Upload endpoint characterization ─────────────────────────────────────
// Current behavior: uses Buffer.from(await file.arrayBuffer()) to write file to disk
// This test characterizes that the endpoint exists and has the expected structure.

describe('Upload endpoint (current behavior — streaming)', () => {
  it('upload endpoint file exists and uses streaming pattern', async () => {
    // Characterize that the implementation now uses streaming (was Buffer.from)
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/routes/api/upload/+server.ts');
    const source = await fs.readFile(filePath, 'utf-8');
    // File exists and exports POST
    expect(source).toMatch(/export (const )?POST/);
    // New implementation uses file.stream() and createWriteStream
    expect(source).toContain('file.stream()');
    expect(source).toContain('createWriteStream');
    // No longer uses Buffer.from for the entire file
    expect(source).not.toContain('Buffer.from(await file.arrayBuffer())');
    // Size check is now via streaming byte count (bytesWritten)
    expect(source).toContain('bytesWritten');
  });
});

// ─── 2. Filter store migration complete (Batch 2) ────────────────────────────
// Post-migration: singleton filterStore removed, replaced by FiltersStore class.
// The singleton-specific tests previously here were the intended regression
// safety net — they were expected to fail once the singleton was deleted.
// New behavior is covered by filters-store.test.ts (class-level tests).

describe('Filter store migration (post-singleton)', () => {
  it('singleton filterStore module no longer exists', async () => {
    // Importing the deleted module must fail — singleton is gone.
    await expect(
      // @ts-expect-error — module intentionally deleted
      import('$lib/stores/filters.svelte.js')
    ).rejects.toThrow();
  });

  it('FiltersStore class is exported from filters-store', async () => {
    const mod = await import('$lib/stores/filters-store.svelte.js');
    expect(typeof mod.FiltersStore).toBe('function');
  });

  it('FiltersStore type exports are available for UI consumers', async () => {
    const mod = await import('$lib/stores/filters-store.svelte.js');
    // Runtime-visible exports that previously lived in filters.svelte.ts
    expect(mod.FILTER_OPERATOR_LABELS).toBeTypeOf('object');
    expect(mod.FILTER_OPERATOR_LABELS.eq).toBe('=');
  });
});

// ─── 3. Geoprocessing router characterization ────────────────────────────────
// After F08 async geoprocessing: router enqueues async job via BullMQ instead of
// synchronous runGeoprocessing. Returns {jobId, layerId, layerName}.
// Worker processes job asynchronously and updates import_jobs table for SSE tracking.

describe('Geoprocessing router (async after F08)', () => {
  it('geoprocessing router source enqueues async job (read source)', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/lib/server/trpc/routers/geoprocessing.ts');
    const source = await fs.readFile(filePath, 'utf-8');

    // File exists and exports router
    expect(source).toMatch(/export (const )?geoprocessingRouter/);
    // Implementation enqueues job and returns jobId
    expect(source).toContain('enqueueGeoprocessingJob');
    expect(source).toContain('jobId');
    // No longer calls runGeoprocessing directly
    expect(source).not.toContain('runGeoprocessing');
  });

  it('geoprocessing router has cancel endpoint', async () => {
    const fs = await import('fs/promises');
    const path = await import('path');
    const filePath = path.resolve(process.cwd(), 'src/lib/server/trpc/routers/geoprocessing.ts');
    const source = await fs.readFile(filePath, 'utf-8');

    expect(source).toContain('cancel:');
    expect(source).toContain('UPDATE import_jobs');
  });
});
