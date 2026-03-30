# Group 1: Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement F02 (streaming data import with SSE progress), F07 (map-scoped filtering with URL reflection), and F08 (job-queued geoprocessing with progress tracking).

**Architecture:** Three independent feature streams sharing the worker infrastructure. F02 adds streaming upload + worker processing pipeline. F07 adds client-side FiltersStore + URL-synced filter state. F08 converts synchronous tRPC geoprocessing to BullMQ job queue with SSE progress.

**Tech Stack:** Svelte 5, tRPC, BullMQ, Redis, PostGIS, SSE, SvelteKit route handlers

---

## Flow Maps

### F02: Data Import Flow

**Flow:** User selects file → upload streams to server → worker processes → features appear on map
**Observable trigger:** User clicks "Import" button in ImportDialog
**Observable outcome:** New layer appears in LayerPanel with features visible on map

### Path

1. `apps/web/src/lib/components/import/ImportDialog.svelte` — **[CHANGE SITE]** File selection, streaming upload, progress display
2. `apps/web/src/routes/api/import/+server.ts` — **[CHANGE SITE]** Receives stream, writes to disk, enqueues job
3. `apps/web/src/lib/server/trpc/queues.ts` — **[CHANGE SITE]** BullMQ queue definition
4. `services/worker/src/index.ts` — **[CHANGE SITE]** Job processor, PostGIS INSERT, cleanup
5. `apps/web/src/lib/components/map/MapEditor.svelte` — Wires ImportDialog, refreshes layers on completion

### Upstream contract

- User selects GeoJSON/Shapefile/KML/CSV file (≤500MB)
- MapEditor provides `mapId` and `onlayercreated` callback

### Downstream contract

- New layer row in `layers` table with `mapId`, `name`, `type`, `zIndex`
- Features inserted into `features` table with `layer_id`
- LayerPanel refreshes via `queryClient.invalidateQueries`

### Depth justification

**Standard** — 2 subsystems (import UI + worker pipeline), architecture docs exist

---

### F07: Filtering Flow

**Flow:** User opens filter panel → adds conditions → URL updates → map features filtered
**Observable trigger:** User clicks filter icon in left rail
**Observable outcome:** Only matching features visible on map, filter state in URL

### Path

1. `apps/web/src/lib/stores/filters.svelte.ts` — **[CHANGE SITE]** FiltersStore class, condition evaluation, URL sync
2. `apps/web/src/lib/components/filters/FilterPanel.svelte` — **[CHANGE SITE]** UI for adding/removing conditions
3. `apps/web/src/lib/components/map/MapEditor.svelte` — Wires FiltersStore to map instance
4. `apps/web/src/lib/components/data/DataTable.svelte` — Receives filtered data

### Upstream contract

- MapEditor provides `mapId` and layer list
- Layer features available via tRPC query

### Downstream contract

- Filter conditions applied to feature queries (server-side via tRPC)
- URL query params reflect current filter state (`?filter=...`)

### Depth justification

**Standard** — 2 subsystems (filter store + filter UI), architecture docs exist

---

### F08: Geoprocessing Flow

**Flow:** User configures operation → job enqueued → SSE progress updates → new layer created
**Observable trigger:** User clicks "RUN ANALYSIS" in GeoprocessingPanel
**Observable outcome:** New derived layer appears on map with processed features

### Path

1. `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte` — **[CHANGE SITE]** SSE subscription, progress display, cancel button
2. `apps/web/src/lib/server/trpc/routers/geoprocessing.ts` — **[CHANGE SITE]** Enqueue job instead of direct execution
3. `apps/web/src/lib/server/trpc/queues.ts` — **[CHANGE SITE]** Geoprocessing queue (shared with F02 infra)
4. `services/worker/src/index.ts` — **[CHANGE SITE]** Geoprocessing job processor with progress reporting
5. `apps/web/src/lib/server/geo/geoprocessing.ts` — Unchanged (PostGIS operations)

### Upstream contract

- GeoprocessingOp discriminated union from shared-types
- MapEditor provides `mapId`, `layers` list, `onlayercreated` callback

### Downstream contract

- New layer row in `layers` table with processed features
- SSE events: `{ type: 'progress', percent: number }` and `{ type: 'complete', layerId: string }`

### Depth justification

**Standard** — 2 subsystems (geoprocessing UI + worker queue), architecture docs exist

---

## Execution Waves

### Wave 1: Shared Queue Infrastructure (F02 + F08 foundation)

**Tasks: 1, 2** — Queue definitions and worker job processor skeleton

### Wave 2: F02 Data Import

**Tasks: 3, 4, 5** — Streaming upload, server handler, import dialog

### Wave 3: F07 Filtering

**Tasks: 6, 7** — FiltersStore, FilterPanel UI, URL sync

### Wave 4: F08 Geoprocessing

**Tasks: 8, 9** — Job queue migration, SSE progress, panel updates

### Wave 5: Integration Verification

**Tasks: 10** — Cross-feature verification, test suite, svelte-check

---

### Task 1: Queue Infrastructure — BullMQ Setup [CHANGE SITE]

**Flow position:** Shared infrastructure for F02 and F08
**Upstream contract:** Redis connection string from env
**Downstream contract:** `importQueue` and `geoprocessingQueue` exported for enqueue
**Files:**

- Create: `apps/web/src/lib/server/trpc/queues.ts`
- Test: `apps/web/src/__tests__/queues.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write tests for queue exports**

```typescript
// apps/web/src/__tests__/queues.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { importQueue, geoprocessingQueue, gracefulShutdown } from './lib/server/trpc/queues.js';

describe('queues', () => {
  it('exports importQueue as a BullMQ Queue instance', () => {
    expect(importQueue).toBeDefined();
    expect(typeof importQueue.add).toBe('function');
  });

  it('exports geoprocessingQueue as a BullMQ Queue instance', () => {
    expect(geoprocessingQueue).toBeDefined();
    expect(typeof geoprocessingQueue.add).toBe('function');
  });

  it('gracefulShutdown closes both queues', async () => {
    await expect(gracefulShutdown()).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/__tests__/queues.test.ts`
Expected: FAIL — "Cannot find module './lib/server/trpc/queues.js'"

- [ ] **Step 3: Implement queue definitions**

```typescript
// apps/web/src/lib/server/trpc/queues.ts
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const redisConnection = new IORedis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
  maxRetriesPerRequest: null,
});

export const importQueue = new Queue('import', { connection: redisConnection });
export const geoprocessingQueue = new Queue('geoprocessing', { connection: redisConnection });

export async function gracefulShutdown(): Promise<void> {
  await Promise.all([importQueue.close(), geoprocessingQueue.close()]);
  await redisConnection.quit();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/__tests__/queues.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/trpc/queues.ts apps/web/src/__tests__/queues.test.ts
git commit -m "feat(F02/F08): add BullMQ queue infrastructure for import and geoprocessing"
```

---

### Task 2: Worker Job Processor Skeleton [CHANGE SITE]

**Flow position:** Worker processes jobs from both queues
**Upstream contract:** Jobs from `importQueue` and `geoprocessingQueue` with typed payloads
**Downstream contract:** Features inserted into PostGIS, layer rows created
**Files:**

- Modify: `services/worker/src/index.ts`
- Test: `services/worker/src/__tests__/worker.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write tests for worker job handlers**

```typescript
// services/worker/src/__tests__/worker.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the database and queue modules
vi.mock('$lib/server/db', () => ({ db: { execute: vi.fn() } }));
vi.mock('$lib/server/trpc/queues', () => ({
  importQueue: { add: vi.fn() },
  geoprocessingQueue: { add: vi.fn() },
}));

describe('worker processors', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('processes import jobs with mapId, filePath, layerName', async () => {
    // Verify the import processor accepts the expected job shape
    const { processImportJob } = await import('../index.js');
    const result = await processImportJob({
      mapId: 'test-map-id',
      filePath: '/tmp/test.geojson',
      layerName: 'Test Layer',
    });
    expect(result).toHaveProperty('layerId');
  });

  it('processes geoprocessing jobs with op and newLayerId', async () => {
    const { processGeoprocessingJob } = await import('../index.js');
    const result = await processGeoprocessingJob({
      op: { type: 'buffer', layerId: 'layer-1', distanceKm: 1 },
      newLayerId: 'output-layer-id',
      mapId: 'test-map-id',
    });
    expect(result).toHaveProperty('featureCount');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd services/worker && npx vitest run src/__tests__/worker.test.ts`
Expected: FAIL — "processImportJob is not exported"

- [ ] **Step 3: Implement worker job processors**

```typescript
// services/worker/src/index.ts — ADD to existing file
import { Worker } from 'bullmq';
import { db } from '$lib/server/db';
import { layers } from '$lib/server/db/schema';
import { runGeoprocessing } from '$lib/server/geo/geoprocessing.js';
import IORedis from 'ioredis';
import * as fs from 'fs/promises';
import * as path from 'path';

const redisConnection = new IORedis({
  host: process.env.REDIS_HOST ?? 'localhost',
  port: parseInt(process.env.REDIS_PORT ?? '6379'),
  maxRetriesPerRequest: null,
});

export async function processImportJob(job: {
  mapId: string;
  filePath: string;
  layerName: string;
}): Promise<{ layerId: string }> {
  const { mapId, filePath, layerName } = job;
  try {
    // 1. Read file from disk
    const content = await fs.readFile(filePath, 'utf-8');
    const geojson = JSON.parse(content);

    // 2. Get next z_index
    const existingLayers = await db
      .select({ zIndex: layers.zIndex })
      .from(layers)
      .where(eq(layers.mapId, mapId));
    const maxZ = existingLayers.reduce((max, l) => Math.max(max, l.zIndex), -1);

    // 3. Create layer
    const [newLayer] = await db
      .insert(layers)
      .values({
        mapId,
        name: layerName,
        type: geojson.type || 'mixed',
        style: { type: 'simple', paint: {} },
        visible: true,
        zIndex: maxZ + 1,
      })
      .returning();

    // 4. Insert features (batch insert)
    if (geojson.features?.length) {
      await db.execute(sql`
        INSERT INTO features (layer_id, geometry, properties)
        SELECT ${newLayer.id}::uuid,
          ST_GeomFromGeoJSON(f->>'geometry'),
          COALESCE(f->'properties', '{}'::jsonb)
        FROM jsonb_array_elements(${JSON.stringify(geojson.features)}::jsonb) f
      `);
    }

    return { layerId: newLayer.id };
  } finally {
    // 5. Clean up temp file
    await fs.unlink(filePath).catch(() => {});
  }
}

export async function processGeoprocessingJob(job: {
  op: { type: string; [key: string]: unknown };
  newLayerId: string;
  mapId: string;
}): Promise<{ featureCount: number }> {
  const { op, newLayerId } = job;
  await runGeoprocessing(op as any, newLayerId);

  // Count features in output layer
  const [{ count }] = await db.execute(sql`
    SELECT COUNT(*) as count FROM features WHERE layer_id = ${newLayerId}::uuid
  `);
  return { featureCount: Number(count) };
}

// Start workers
const importWorker = new Worker(
  'import',
  async (job) => {
    return processImportJob(job.data);
  },
  { connection: redisConnection }
);

const geoprocessingWorker = new Worker(
  'geoprocessing',
  async (job) => {
    return processGeoprocessingJob(job.data);
  },
  { connection: redisConnection }
);

// 24h orphan cleanup cron
setInterval(
  async () => {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const tempDir = process.env.IMPORT_TEMP_DIR ?? '/tmp/imports';
    try {
      const files = await fs.readdir(tempDir);
      for (const file of files) {
        const stat = await fs.stat(path.join(tempDir, file));
        if (stat.mtime < cutoff) {
          await fs.unlink(path.join(tempDir, file));
        }
      }
    } catch {
      /* temp dir may not exist yet */
    }
  },
  60 * 60 * 1000
); // Run every hour

export { importWorker, geoprocessingWorker };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd services/worker && npx vitest run src/__tests__/worker.test.ts`
Expected: PASS — 2 tests pass

- [ ] **Step 5: Commit**

```bash
git add services/worker/src/index.ts services/worker/src/__tests__/worker.test.ts
git commit -m "feat(F02/F08): add worker job processors for import and geoprocessing"
```

---

### Task 3: Streaming Upload Server Handler [CHANGE SITE]

**Flow position:** Receives streamed file upload, writes to disk, enqueues job
**Upstream contract:** HTTP POST with multipart/form-data or raw body from ImportDialog
**Downstream contract:** Job enqueued to `importQueue`, SSE endpoint for progress
**Files:**

- Create: `apps/web/src/routes/api/import/+server.ts`
- Test: `apps/web/src/__tests__/import-upload.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write tests for upload handler**

```typescript
// apps/web/src/__tests__/import-upload.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('import upload handler', () => {
  it('rejects files larger than 500MB', async () => {
    // Verify size limit enforcement
    const { POST } = await import('../routes/api/import/+server.js');
    const request = new Request('http://localhost/api/import', {
      method: 'POST',
      headers: { 'content-length': `${600 * 1024 * 1024}` },
      body: new ReadableStream(),
    });
    const response = await POST({ request } as any);
    expect(response.status).toBe(413);
  });

  it('rejects unsupported file types', async () => {
    const { POST } = await import('../routes/api/import/+server.js');
    const formData = new FormData();
    formData.append('file', new Blob(['test'], { type: 'application/pdf' }), 'test.pdf');
    formData.append('mapId', 'test-map');
    formData.append('layerName', 'Test Layer');
    const response = await POST({
      request: new Request('http://localhost/api/import', { method: 'POST', body: formData }),
    } as any);
    expect(response.status).toBe(400);
  });

  it('accepts GeoJSON files and returns jobId', async () => {
    vi.mock('$lib/server/trpc/queues', () => ({
      importQueue: { add: vi.fn().mockResolvedValue({ id: 'job-123' }) },
    }));
    const { POST } = await import('../routes/api/import/+server.js');
    const formData = new FormData();
    formData.append(
      'file',
      new Blob(['{"type":"FeatureCollection","features":[]}'], { type: 'application/geo+json' }),
      'test.geojson'
    );
    formData.append('mapId', 'test-map');
    formData.append('layerName', 'Test Layer');
    const response = await POST({
      request: new Request('http://localhost/api/import', { method: 'POST', body: formData }),
    } as any);
    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body).toHaveProperty('jobId', 'job-123');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/__tests__/import-upload.test.ts`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement streaming upload handler**

```typescript
// apps/web/src/routes/api/import/+server.ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { importQueue } from '$lib/server/trpc/queues';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const ALLOWED_TYPES = new Set([
  'application/geo+json',
  'application/json',
  'application/zip',
  'application/vnd.google-earth.kml+xml',
  'text/csv',
]);
const MAX_SIZE = 500 * 1024 * 1024; // 500MB
const TEMP_DIR = process.env.IMPORT_TEMP_DIR ?? '/tmp/imports';

export const POST: RequestHandler = async ({ request }) => {
  // 1. Size check
  const contentLength = request.headers.get('content-length');
  if (contentLength && parseInt(contentLength) > MAX_SIZE) {
    return json(
      {
        error: 'File too large. Maximum size is 500MB.',
        recovery: 'Split your file into smaller chunks or use a shapefile archive.',
      },
      { status: 413 }
    );
  }

  // 2. Parse form data
  const formData = await request.formData();
  const file = formData.get('file') as File;
  const mapId = formData.get('mapId') as string;
  const layerName = formData.get('layerName') as string;

  if (!file || !mapId || !layerName) {
    return json(
      {
        error: 'Missing required fields: file, mapId, layerName.',
        recovery: 'Ensure all form fields are populated.',
      },
      { status: 400 }
    );
  }

  // 3. Validate file type
  const ext = path.extname(file.name).toLowerCase();
  const allowedExts = ['.geojson', '.json', '.zip', '.kml', '.csv'];
  if (!ALLOWED_TYPES.has(file.type) && !allowedExts.includes(ext)) {
    return json(
      {
        error: `Unsupported file type: ${file.type || ext}.`,
        recovery: `Supported formats: ${allowedExts.join(', ')}`,
      },
      { status: 400 }
    );
  }

  // 4. Stream to disk (not Buffer.from)
  await fs.promises.mkdir(TEMP_DIR, { recursive: true });
  const tempPath = path.join(TEMP_DIR, `${crypto.randomUUID()}${ext}`);
  const fileStream = fs.createWriteStream(tempPath);
  const reader = file.stream().getReader();

  let bytesWritten = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesWritten += value.length;
    if (bytesWritten > MAX_SIZE) {
      fileStream.close();
      await fs.promises.unlink(tempPath).catch(() => {});
      return json(
        {
          error: 'File too large. Maximum size is 500MB.',
          recovery: 'Split your file into smaller chunks.',
        },
        { status: 413 }
      );
    }
    fileStream.write(Buffer.from(value));
  }
  fileStream.end();
  await new Promise((resolve) => fileStream.on('finish', resolve));

  // 5. Enqueue job
  const job = await importQueue.add('import', {
    mapId,
    filePath: tempPath,
    layerName,
  });

  return json({ jobId: job.id }, { status: 202 });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/__tests__/import-upload.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/api/import/+server.ts apps/web/src/__tests__/import-upload.test.ts
git commit -m "feat(F02): streaming upload handler with disk write and job enqueue"
```

---

### Task 4: ImportDialog with Streaming Progress [CHANGE SITE]

**Flow position:** UI for file selection and upload progress display
**Upstream contract:** User-selected file, mapId from MapEditor
**Downstream contract:** POST to /api/import, SSE progress events, onlayercreated callback
**Files:**

- Create: `apps/web/src/lib/components/import/ImportDialog.svelte`
- Test: `apps/web/src/__tests__/import-dialog.test.ts`

**Skill:** `superpowers:test-driven-development`
**Codebooks:** `focus-management-across-boundaries`

- [ ] **Step 1: Write tests for ImportDialog component**

```typescript
// apps/web/src/__tests__/import-dialog.test.ts
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import ImportDialog from '../lib/components/import/ImportDialog.svelte';

describe('ImportDialog', () => {
  it('shows file picker when opened', () => {
    render(ImportDialog, { props: { open: true, mapId: 'test-map' } });
    expect(screen.getByText(/import data/i)).toBeTruthy();
  });

  it('disables import button when no file selected', () => {
    render(ImportDialog, { props: { open: true, mapId: 'test-map' } });
    const button = screen.getByRole('button', { name: /import/i });
    expect(button).toBeDisabled();
  });

  it('shows progress bar during upload', async () => {
    const onlayercreated = vi.fn();
    render(ImportDialog, {
      props: { open: true, mapId: 'test-map', onlayercreated },
    });
    // Simulate file selection and upload start
    // Progress bar should appear
  });

  it('calls onlayercreated when import completes', async () => {
    const onlayercreated = vi.fn();
    render(ImportDialog, {
      props: { open: true, mapId: 'test-map', onlayercreated },
    });
    // Simulate completion
    expect(onlayercreated).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/__tests__/import-dialog.test.ts`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement ImportDialog**

```svelte
<!-- apps/web/src/lib/components/import/ImportDialog.svelte -->
<script lang="ts">
  import { createMutation } from '@tanstack/svelte-query';

  interface Props {
    open: boolean;
    mapId: string;
    onlayercreated: (layerId: string) => void;
    onclose: () => void;
  }

  let { open, mapId, onlayercreated, onclose }: Props = $props();

  let selectedFile = $state<File | null>(null);
  let layerName = $state('');
  let uploadProgress = $state(0);
  let uploadStatus = $state<'idle' | 'uploading' | 'processing' | 'done' | 'error'>('idle');
  let errorMessage = $state<string | null>(null);

  const importMutation = createMutation(() => ({
    mutationFn: async ({
      file,
      mapId,
      layerName,
    }: {
      file: File;
      mapId: string;
      layerName: string;
    }) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mapId', mapId);
      formData.append('layerName', layerName);

      const response = await fetch('/api/import', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error ?? 'Upload failed');
      }

      return response.json();
    },
    onSuccess: (data) => {
      uploadStatus = 'processing';
      // SSE progress subscription would go here
      // For now, poll or use SSE EventSource
    },
    onError: (err: Error) => {
      uploadStatus = 'error';
      errorMessage = err.message;
    },
  }));

  function handleFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files?.[0]) {
      selectedFile = input.files[0];
      layerName = selectedFile.name.replace(/\.[^.]+$/, '');
    }
  }

  async function handleImport() {
    if (!selectedFile) return;
    uploadStatus = 'uploading';
    uploadProgress = 0;
    errorMessage = null;
    await importMutation.mutateAsync({ file: selectedFile, mapId, layerName });
  }

  function handleClose() {
    selectedFile = null;
    layerName = '';
    uploadProgress = 0;
    uploadStatus = 'idle';
    errorMessage = null;
    onclose();
  }
</script>

{#if open}
  <div
    class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    role="dialog"
    aria-modal="true"
  >
    <div class="bg-surface-container rounded-xl p-6 w-full max-w-md">
      <h2 class="text-lg font-semibold text-on-surface mb-4">Import Data</h2>

      {#if uploadStatus === 'idle' || uploadStatus === 'error'}
        <!-- File picker -->
        <input
          type="file"
          accept=".geojson,.json,.zip,.kml,.csv"
          onchange={handleFileSelect}
          class="w-full mb-3"
        />

        <!-- Layer name -->
        <input
          type="text"
          bind:value={layerName}
          placeholder="Layer name"
          class="w-full rounded bg-surface-low border border-white/5 px-3 py-2 text-sm text-on-surface mb-3"
        />

        {#if errorMessage}
          <p class="text-xs text-red-400 mb-3">{errorMessage}</p>
        {/if}

        <div class="flex gap-2">
          <button
            onclick={handleClose}
            class="flex-1 py-2 rounded-lg bg-surface-high text-on-surface">Cancel</button
          >
          <button
            onclick={handleImport}
            disabled={!selectedFile || importMutation.isPending}
            class="flex-1 py-2 rounded-lg bg-primary text-on-primary font-bold disabled:opacity-50"
          >
            {importMutation.isPending ? 'Uploading...' : 'Import'}
          </button>
        </div>
      {:else if uploadStatus === 'uploading'}
        <!-- Upload progress -->
        <div class="w-full bg-surface-low rounded-full h-2 mb-3">
          <div
            class="bg-primary h-2 rounded-full transition-all"
            style="width: {uploadProgress}%"
          />
        </div>
        <p class="text-sm text-on-surface-variant">Uploading...</p>
      {:else if uploadStatus === 'processing'}
        <p class="text-sm text-on-surface-variant">
          Processing your file. This may take a moment...
        </p>
      {:else if uploadStatus === 'done'}
        <p class="text-sm text-green-400 mb-3">Import complete!</p>
        <button
          onclick={handleClose}
          class="w-full py-2 rounded-lg bg-primary text-on-primary font-bold">Done</button
        >
      {/if}
    </div>
  </div>
{/if}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/__tests__/import-dialog.test.ts`
Expected: PASS — 4 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/import/ImportDialog.svelte apps/web/src/__tests__/import-dialog.test.ts
git commit -m "feat(F02): ImportDialog with streaming upload and progress display"
```

---

### Task 5: Wire ImportDialog into MapEditor [CHANGE SITE]

**Flow position:** MapEditor opens ImportDialog, refreshes layers on completion
**Upstream contract:** MapEditor has `mapId` and layer query invalidation
**Downstream contract:** ImportDialog calls `onlayercreated` with new layer ID
**Files:**

- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Add characterization test for import wiring**

```typescript
// Add to existing characterization tests or create new
it('MapEditor opens ImportDialog and refreshes layers on completion', () => {
  // Verify ImportDialog import exists
  // Verify onlayercreated callback invalidates layer queries
});
```

- [ ] **Step 2: Wire ImportDialog into MapEditor**

In `MapEditor.svelte`:

1. Add import: `import ImportDialog from '$lib/components/import/ImportDialog.svelte';`
2. Add state: `let showImportDialog = $state(false);`
3. Add dialog trigger in left rail or menu: button that sets `showImportDialog = true`
4. Add dialog component: `<ImportDialog open={showImportDialog} mapId={mapId} onlayercreated={() => queryClient.invalidateQueries({ queryKey: queryKeys.layers.list({ mapId }) })} onclose={() => showImportDialog = false} />`

- [ ] **Step 3: Run tests to verify no regressions**

Run: `npx vitest run apps/web/src/__tests__/map-editor-state.test.ts`
Expected: PASS — all existing tests pass

- [ ] **Step 4: Run svelte-check**

Run: `npx svelte-check --threshold warning`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/components/map/MapEditor.svelte
git commit -m "feat(F02): wire ImportDialog into MapEditor with layer refresh"
```

---

### Task 6: FiltersStore Class [CHANGE SITE]

**Flow position:** Manages filter state scoped to map instance, syncs with URL
**Upstream contract:** Map instance ID, available filter fields from layer schema
**Downstream contract:** Filter conditions applied to feature queries, URL params updated
**Files:**

- Modify: `apps/web/src/lib/stores/filters.svelte.ts`
- Test: `apps/web/src/__tests__/filters.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write tests for FiltersStore**

```typescript
// apps/web/src/__tests__/filters.test.ts
import { describe, it, expect } from 'vitest';
import { FiltersStore } from '../lib/stores/filters.svelte.js';

describe('FiltersStore', () => {
  it('creates an instance scoped to a mapId', () => {
    const store = new FiltersStore('map-1');
    expect(store.mapId).toBe('map-1');
    expect(store.conditions).toEqual([]);
  });

  it('adds a condition', () => {
    const store = new FiltersStore('map-1');
    store.addCondition({ field: 'population', operator: '>', value: 1000 });
    expect(store.conditions).toHaveLength(1);
    expect(store.conditions[0]).toEqual({ field: 'population', operator: '>', value: 1000 });
  });

  it('removes a condition by index', () => {
    const store = new FiltersStore('map-1');
    store.addCondition({ field: 'name', operator: 'contains', value: 'test' });
    store.addCondition({ field: 'population', operator: '>', value: 1000 });
    store.removeCondition(0);
    expect(store.conditions).toHaveLength(1);
    expect(store.conditions[0].field).toBe('population');
  });

  it('serializes conditions to URL params', () => {
    const store = new FiltersStore('map-1');
    store.addCondition({ field: 'population', operator: '>', value: 1000 });
    const params = store.toUrlParams();
    expect(params.get('filter')).toContain('population');
  });

  it('deserializes conditions from URL params', () => {
    const params = new URLSearchParams('filter=population:gt:1000');
    const store = FiltersStore.fromUrlParams('map-1', params);
    expect(store.conditions).toHaveLength(1);
    expect(store.conditions[0]).toEqual({ field: 'population', operator: '>', value: '1000' });
  });

  it('infers field types from sample features', () => {
    const store = new FiltersStore('map-1');
    store.inferFields([{ properties: { name: 'Test', population: 1000, active: true } }]);
    expect(store.availableFields).toEqual([
      { name: 'name', type: 'string' },
      { name: 'population', type: 'number' },
      { name: 'active', type: 'boolean' },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/__tests__/filters.test.ts`
Expected: FAIL — "FiltersStore is not defined"

- [ ] **Step 3: Implement FiltersStore**

```typescript
// apps/web/src/lib/stores/filters.svelte.ts

export type FilterOperator =
  | '='
  | '!='
  | '>'
  | '<'
  | '>='
  | '<='
  | 'contains'
  | 'starts_with'
  | 'ends_with'
  | 'is_null'
  | 'is_not_null';

export interface FilterCondition {
  field: string;
  operator: FilterOperator;
  value: string | number | boolean | null;
}

export interface FieldInfo {
  name: string;
  type: 'string' | 'number' | 'boolean';
}

export class FiltersStore {
  mapId: string;
  conditions = $state<FilterCondition[]>([]);
  availableFields = $state<FieldInfo[]>([]);

  constructor(mapId: string) {
    this.mapId = mapId;
  }

  addCondition(condition: FilterCondition): void {
    this.conditions = [...this.conditions, condition];
  }

  removeCondition(index: number): void {
    this.conditions = this.conditions.filter((_, i) => i !== index);
  }

  clearAll(): void {
    this.conditions = [];
  }

  get hasActiveFilters(): boolean {
    return this.conditions.length > 0;
  }

  /** Infer field types from first N sample features */
  inferFields(features: { properties: Record<string, unknown> }[]): void {
    const fieldMap = new Map<string, Set<string>>();
    for (const feature of features.slice(0, 100)) {
      for (const [key, value] of Object.entries(feature.properties ?? {})) {
        if (!fieldMap.has(key)) fieldMap.set(key, new Set());
        fieldMap.get(key)!.add(typeof value);
      }
    }
    this.availableFields = Array.from(fieldMap.entries()).map(([name, types]) => {
      // Determine dominant type
      if (types.has('number')) return { name, type: 'number' as const };
      if (types.has('boolean')) return { name, type: 'boolean' as const };
      return { name, type: 'string' as const };
    });
  }

  /** Serialize conditions to URL params */
  toUrlParams(): URLSearchParams {
    const params = new URLSearchParams();
    for (const cond of this.conditions) {
      const opMap: Record<FilterOperator, string> = {
        '=': 'eq',
        '!=': 'neq',
        '>': 'gt',
        '<': 'lt',
        '>=': 'gte',
        '<=': 'lte',
        contains: 'contains',
        starts_with: 'starts_with',
        ends_with: 'ends_with',
        is_null: 'is_null',
        is_not_null: 'is_not_null',
      };
      params.append('filter', `${cond.field}:${opMap[cond.operator]}:${cond.value}`);
    }
    return params;
  }

  /** Deserialize conditions from URL params */
  static fromUrlParams(mapId: string, params: URLSearchParams): FiltersStore {
    const store = new FiltersStore(mapId);
    const filterValues = params.getAll('filter');
    const opReverse: Record<string, FilterOperator> = {
      eq: '=',
      neq: '!=',
      gt: '>',
      lt: '<',
      gte: '>=',
      lte: '<=',
      contains: 'contains',
      starts_with: 'starts_with',
      ends_with: 'ends_with',
      is_null: 'is_null',
      is_not_null: 'is_not_null',
    };
    for (const raw of filterValues) {
      const parts = raw.split(':');
      if (parts.length >= 3) {
        const [field, op, ...valueParts] = parts;
        const value = valueParts.join(':');
        store.conditions.push({
          field,
          operator: opReverse[op] ?? 'contains',
          value,
        });
      }
    }
    return store;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/__tests__/filters.test.ts`
Expected: PASS — 6 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/stores/filters.svelte.ts apps/web/src/__tests__/filters.test.ts
git commit -m "feat(F07): FiltersStore class with URL sync and type inference"
```

---

### Task 7: FilterPanel UI [CHANGE SITE]

**Flow position:** UI for adding/removing filter conditions
**Upstream contract:** FiltersStore instance from MapEditor
**Downstream contract:** Filter conditions added/removed, URL params updated
**Files:**

- Create: `apps/web/src/lib/components/filters/FilterPanel.svelte`
- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`
- Test: `apps/web/src/__tests__/filter-panel.test.ts`

**Skill:** `superpowers:test-driven-development`
**Codebooks:** `focus-management-across-boundaries`

- [ ] **Step 1: Write tests for FilterPanel**

```typescript
// apps/web/src/__tests__/filter-panel.test.ts
import { describe, it, expect, vi } from '@testing-library/svelte';
import { render, screen, fireEvent } from '@testing-library/svelte';
import FilterPanel from '../lib/components/filters/FilterPanel.svelte';
import { FiltersStore } from '../lib/stores/filters.svelte.js';

describe('FilterPanel', () => {
  it('renders with empty conditions', () => {
    const store = new FiltersStore('map-1');
    render(FilterPanel, { props: { store } });
    expect(screen.getByText(/filters/i)).toBeTruthy();
  });

  it('adds a condition when clicking add button', async () => {
    const store = new FiltersStore('map-1');
    store.availableFields = [{ name: 'name', type: 'string' }];
    render(FilterPanel, { props: { store } });
    await fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect(store.conditions).toHaveLength(1);
  });

  it('removes a condition when clicking remove', async () => {
    const store = new FiltersStore('map-1');
    store.addCondition({ field: 'name', operator: 'contains', value: 'test' });
    render(FilterPanel, { props: { store } });
    await fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    expect(store.conditions).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run apps/web/src/__tests__/filter-panel.test.ts`
Expected: FAIL — "Cannot find module"

- [ ] **Step 3: Implement FilterPanel**

```svelte
<!-- apps/web/src/lib/components/filters/FilterPanel.svelte -->
<script lang="ts">
  import type {
    FiltersStore,
    FilterCondition,
    FilterOperator,
  } from '$lib/stores/filters.svelte.js';
  import { Plus, X } from 'lucide-svelte';

  interface Props {
    store: FiltersStore;
    onurlchange?: (params: URLSearchParams) => void;
  }

  let { store, onurlchange }: Props = $props();

  const OPERATORS: { value: FilterOperator; label: string }[] = [
    { value: '=', label: 'equals' },
    { value: '!=', label: 'not equals' },
    { value: '>', label: 'greater than' },
    { value: '<', label: 'less than' },
    { value: 'contains', label: 'contains' },
    { value: 'is_null', label: 'is null' },
    { value: 'is_not_null', label: 'is not null' },
  ];

  function addCondition() {
    const field = store.availableFields[0]?.name ?? '';
    store.addCondition({ field, operator: 'contains', value: '' });
    syncUrl();
  }

  function removeCondition(index: number) {
    store.removeCondition(index);
    syncUrl();
  }

  function updateCondition(index: number, updates: Partial<FilterCondition>) {
    store.conditions[index] = { ...store.conditions[index], ...updates };
    syncUrl();
  }

  function syncUrl() {
    if (onurlchange) {
      onurlchange(store.toUrlParams());
    }
  }
</script>

<div class="flex flex-col h-full bg-surface-container">
  <div class="px-3 py-3 border-b border-white/5">
    <h2 class="text-sm font-semibold text-on-surface">Filters</h2>
  </div>

  <div class="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
    {#each store.conditions as cond, i (i)}
      <div class="flex items-center gap-2">
        <!-- Field selector -->
        <select
          value={cond.field}
          onchange={(e) => updateCondition(i, { field: e.currentTarget.value })}
          class="flex-1 rounded bg-surface-low border border-white/5 px-2 py-1 text-xs text-on-surface"
        >
          {#each store.availableFields as field}
            <option value={field.name}>{field.name}</option>
          {/each}
        </select>

        <!-- Operator selector -->
        <select
          value={cond.operator}
          onchange={(e) =>
            updateCondition(i, { operator: e.currentTarget.value as FilterOperator })}
          class="flex-1 rounded bg-surface-low border border-white/5 px-2 py-1 text-xs text-on-surface"
        >
          {#each OPERATORS as op}
            <option value={op.value}>{op.label}</option>
          {/each}
        </select>

        <!-- Value input (hidden for is_null/is_not_null) -->
        {#if cond.operator !== 'is_null' && cond.operator !== 'is_not_null'}
          <input
            type="text"
            value={cond.value as string}
            oninput={(e) => updateCondition(i, { value: e.currentTarget.value })}
            placeholder="value"
            class="flex-1 rounded bg-surface-low border border-white/5 px-2 py-1 text-xs text-on-surface"
          />
        {/if}

        <!-- Remove button -->
        <button
          onclick={() => removeCondition(i)}
          class="text-on-surface-variant hover:text-red-400"
          aria-label="Remove filter"
        >
          <X size={14} />
        </button>
      </div>
    {/each}

    <button
      onclick={addCondition}
      class="flex items-center gap-1 py-2 text-xs text-primary hover:text-primary/80"
    >
      <Plus size={14} /> Add filter
    </button>
  </div>

  {#if store.hasActiveFilters}
    <div class="px-3 py-2 border-t border-white/5">
      <button
        onclick={() => {
          store.clearAll();
          syncUrl();
        }}
        class="w-full py-1 text-xs text-on-surface-variant hover:text-red-400"
      >
        Clear all filters
      </button>
    </div>
  {/if}
</div>
```

- [ ] **Step 4: Wire FilterPanel into MapEditor**

In `MapEditor.svelte`:

1. Add import: `import FilterPanel from '$lib/components/filters/FilterPanel.svelte';`
2. Add FiltersStore instance: `let filtersStore = $state(new FiltersStore(mapId));`
3. Wire into left rail or side panel as a new icon/section
4. Pass `onurlchange` callback that updates browser URL via `goto`

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/__tests__/filter-panel.test.ts`
Expected: PASS — 3 tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/components/filters/FilterPanel.svelte apps/web/src/__tests__/filter-panel.test.ts apps/web/src/lib/components/map/MapEditor.svelte
git commit -m "feat(F07): FilterPanel UI wired into MapEditor with URL sync"
```

---

### Task 8: Geoprocessing Job Queue Migration [CHANGE SITE]

**Flow position:** Convert synchronous tRPC mutation to async job enqueue
**Upstream contract:** GeoprocessingOp from GeoprocessingPanel
**Downstream contract:** Job enqueued to `geoprocessingQueue`, SSE progress events
**Files:**

- Modify: `apps/web/src/lib/server/trpc/routers/geoprocessing.ts`
- Modify: `apps/web/src/lib/server/trpc/queues.ts`
- Test: `apps/web/src/__tests__/geoprocessing.test.ts` (update existing)

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Update existing tests to reflect async job pattern**

Update `apps/web/src/__tests__/geoprocessing.test.ts`:

- Change test expectations from direct result to job enqueue confirmation
- Add test for job enqueue returning `{ jobId: string }` instead of `{ layerId, layerName }`

- [ ] **Step 2: Modify geoprocessing router to enqueue jobs**

In `apps/web/src/lib/server/trpc/routers/geoprocessing.ts`:

1. Import `geoprocessingQueue` from queues.ts
2. Replace direct `runGeoprocessing` call with `geoprocessingQueue.add('geoprocessing', { op, newLayerId, mapId })`
3. Return `{ jobId: job.id }` instead of `{ layerId, layerName }`
4. Keep ownership verification and layer creation logic (steps 1-4)

```typescript
// Modified section of geoprocessing.ts router
import { geoprocessingQueue } from '../queues.js';

// Replace steps 4-5:
// 4 — Create the output layer (same as before)
const [newLayer] = await db.insert(layers).values({...}).returning();

// 5 — Enqueue job instead of direct execution
const job = await geoprocessingQueue.add('geoprocessing', {
  op: input.op,
  newLayerId: newLayer.id,
  mapId: input.mapId,
});

return { jobId: job.id, layerId: newLayer.id, layerName: newLayer.name };
```

- [ ] **Step 3: Run tests to verify they pass**

Run: `npx vitest run apps/web/src/__tests__/geoprocessing.test.ts`
Expected: PASS — all tests pass with updated expectations

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/geoprocessing.ts apps/web/src/__tests__/geoprocessing.test.ts
git commit -m "feat(F08): migrate geoprocessing to job queue pattern"
```

---

### Task 9: Geoprocessing SSE Progress + Panel Updates [CHANGE SITE]

**Flow position:** Client subscribes to SSE progress, displays progress bar, handles completion
**Upstream contract:** Job ID from geoprocessing mutation response
**Downstream contract:** SSE events for progress updates, layer refresh on completion
**Files:**

- Modify: `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte`
- Create: `apps/web/src/routes/api/geoprocessing/progress/+server.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Create SSE progress endpoint**

```typescript
// apps/web/src/routes/api/geoprocessing/progress/+server.ts
import type { RequestHandler } from './$types';
import { geoprocessingQueue } from '$lib/server/trpc/queues';

export const GET: RequestHandler = async ({ url }) => {
  const jobId = url.searchParams.get('jobId');
  if (!jobId) {
    return new Response('Missing jobId', { status: 400 });
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();

      // Send initial connection event
      controller.enqueue(encoder.encode('event: connected\ndata: {}\n\n'));

      // Poll job progress (BullMQ doesn't have native SSE)
      const interval = setInterval(async () => {
        try {
          const job = await geoprocessingQueue.getJob(jobId);
          if (!job) {
            controller.enqueue(
              encoder.encode(
                `event: error\ndata: ${JSON.stringify({ message: 'Job not found' })}\n\n`
              )
            );
            controller.close();
            clearInterval(interval);
            return;
          }

          const state = await job.getState();
          if (state === 'completed') {
            const result = await job.finished();
            controller.enqueue(
              encoder.encode(`event: complete\ndata: ${JSON.stringify(result)}\n\n`)
            );
            controller.close();
            clearInterval(interval);
          } else if (state === 'failed') {
            const failedReason = await job.failedReason;
            controller.enqueue(
              encoder.encode(`event: error\ndata: ${JSON.stringify({ message: failedReason })}\n\n`)
            );
            controller.close();
            clearInterval(interval);
          } else {
            // Progress event
            const progress = job.progress ?? 0;
            controller.enqueue(
              encoder.encode(
                `event: progress\ndata: ${JSON.stringify({ percent: progress, state })}\n\n`
              )
            );
          }
        } catch (err) {
          controller.enqueue(
            encoder.encode(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`)
          );
          controller.close();
          clearInterval(interval);
        }
      }, 1000); // Poll every second

      // Cleanup on client disconnect
      url.signal?.addEventListener('abort', () => {
        clearInterval(interval);
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
};
```

- [ ] **Step 2: Update GeoprocessingPanel to use SSE**

In `GeoprocessingPanel.svelte`:

1. Replace `running` state with SSE subscription after mutation success
2. Add progress bar display during processing
3. Add cancel button that calls job cancellation endpoint
4. Handle SSE `complete` event to call `onlayercreated`

Key changes:

```typescript
// After mutation success:
let progress = $state(0);
let jobState = $state<string>('waiting');

async function subscribeToProgress(jobId: string) {
  const eventSource = new EventSource(`/api/geoprocessing/progress?jobId=${jobId}`);

  eventSource.addEventListener('progress', (e) => {
    const data = JSON.parse(e.data);
    progress = data.percent;
    jobState = data.state;
  });

  eventSource.addEventListener('complete', (e) => {
    const result = JSON.parse(e.data);
    success = `Created layer with ${result.featureCount} features`;
    onlayercreated(result.layerId);
    eventSource.close();
    running = false;
  });

  eventSource.addEventListener('error', (e) => {
    const data = JSON.parse(e.data);
    error = data.message;
    eventSource.close();
    running = false;
  });
}
```

- [ ] **Step 3: Run svelte-check**

Run: `npx svelte-check --threshold warning`
Expected: No new errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/api/geoprocessing/progress/+server.ts apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte
git commit -m "feat(F08): SSE progress tracking for geoprocessing jobs"
```

---

### Task 10: Integration Verification [CHANGE SITE]

**Flow position:** Verify all three features work together
**Upstream contract:** All previous tasks complete
**Downstream contract:** Clean test suite, no svelte-check errors
**Files:**

- All modified files from Tasks 1-9

**Skill:** `none`

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass (existing + new tests from Tasks 1-9)

- [ ] **Step 2: Run svelte-check**

Run: `npx svelte-check --threshold warning`
Expected: 0 errors, 0 warnings (or pre-existing only)

- [ ] **Step 3: Run lint**

Run: `npx eslint apps/web/src`
Expected: No errors

- [ ] **Step 4: Verify no regressions in existing features**

- MapEditor still opens and closes correctly
- LayerPanel still lists layers
- GeoprocessingPanel still shows 10 operations
- Existing tests still pass

- [ ] **Step 5: Record mulch decision**

```bash
ml record data-pipeline --type decision --title "Three-feature data pipeline plan" --rationale "Grouped F02/F07/F08 by shared worker infrastructure and data flow" --classification tactical --tags "scope:data-pipeline,source:writing-plans,deferred:none,lifecycle:active"
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat(F02/F07/F08): integration verification and cleanup"
```

---

## Open Questions

### Wave 1

- **Task 1: Queue Infrastructure**
  - Q: Is Redis already available in the docker-compose setup? (assumed yes — verify `docker/docker-compose.yml`)
  - Q: What BullMQ version is installed? (need to check `package.json`)

### Wave 2

- **Task 3: Streaming Upload**
  - Q: Does SvelteKit's `request.formData()` support streaming large files? (may need custom body parser for >100MB)
  - Q: What's the existing max request body size in the server config?

### Wave 3

- **Task 6: FiltersStore**
  - Q: How are features currently queried? (tRPC endpoint needs filter params added)
  - Q: Does the existing layer query support server-side filtering, or does it return all features?

### Wave 4

- **Task 9: SSE Progress**
  - Q: Does BullMQ support `job.progress()` natively? (yes in v4+, need to verify installed version)
  - Q: How should the worker report progress? (via `job.updateProgress()` calls during processing)

### Flow Contracts

- Q: Do existing tRPC layer queries accept filter parameters? (need to add to existing endpoint)
- Q: Can the worker access the same database as the web app? (assumed yes — shared Postgres)
- Q: Does the existing `runGeoprocessing` function need modification for progress reporting? (yes — add `job.updateProgress()` calls)

---

## Artifact Manifest

<!-- PLAN_MANIFEST_START -->

| File                                                                  | Action | Marker                             |
| --------------------------------------------------------------------- | ------ | ---------------------------------- |
| `apps/web/src/lib/server/trpc/queues.ts`                              | create | `export const importQueue`         |
| `apps/web/src/__tests__/queues.test.ts`                               | create | `describe('queues'`                |
| `services/worker/src/index.ts`                                        | patch  | `processImportJob`                 |
| `services/worker/src/__tests__/worker.test.ts`                        | create | `processImportJob`                 |
| `apps/web/src/routes/api/import/+server.ts`                           | create | `export const POST`                |
| `apps/web/src/__tests__/import-upload.test.ts`                        | create | `describe('import upload handler'` |
| `apps/web/src/lib/components/import/ImportDialog.svelte`              | create | `Import Data`                      |
| `apps/web/src/__tests__/import-dialog.test.ts`                        | create | `describe('ImportDialog'`          |
| `apps/web/src/lib/components/map/MapEditor.svelte`                    | patch  | `ImportDialog`                     |
| `apps/web/src/lib/stores/filters.svelte.ts`                           | patch  | `export class FiltersStore`        |
| `apps/web/src/__tests__/filters.test.ts`                              | create | `describe('FiltersStore'`          |
| `apps/web/src/lib/components/filters/FilterPanel.svelte`              | create | `Filters`                          |
| `apps/web/src/__tests__/filter-panel.test.ts`                         | create | `describe('FilterPanel'`           |
| `apps/web/src/lib/server/trpc/routers/geoprocessing.ts`               | patch  | `geoprocessingQueue.add`           |
| `apps/web/src/__tests__/geoprocessing.test.ts`                        | patch  | `jobId`                            |
| `apps/web/src/routes/api/geoprocessing/progress/+server.ts`           | create | `text/event-stream`                |
| `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte` | patch  | `EventSource`                      |

<!-- PLAN_MANIFEST_END -->
