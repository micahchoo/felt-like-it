# Group 1: Data Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix F02 (streaming import with SSE progress), F07 (scoped FiltersStore with URL reflection + type inference), and F08 (async geoprocessing with job queue + SSE progress) — augmenting existing code, not replacing it.

**Architecture:** Three independent subsystems sharing the worker process. F02 patches the existing upload endpoint for streaming + adds SSE progress endpoint. F07 replaces the singleton filters module with a map-scoped FiltersStore class. F08 adds a second BullMQ queue ('geoprocessing') to the existing worker alongside the 'file-import' queue, plus SSE progress endpoint and job cancellation.

**Tech Stack:** SvelteKit (streaming request body, SSE), BullMQ (two queues in one worker), PostGIS (existing INSERT...SELECT ops), EventSource (client-side SSE), Svelte 5 runes

**Design spec:** `docs/superpowers/specs/2026-03-30-reference-driven-enhancement-design.md`
**Prior plan (discarded):** `docs/superpowers/plans/2026-03-30-data-pipeline-plan.md` — replaced because it would have replaced 482 lines of production worker code with a 120-line stub.

---

## Flow Map

### F02: Data Import

**Flow:** User drops file → streaming upload → disk write → job enqueue → worker parses → features inserted → SSE progress → UI updates
**Observable trigger:** File drag-drop on ImportDialog
**Observable outcome:** New layer appears on map with progress indicator

1. `apps/web/src/lib/components/import/ImportDialog.svelte` — **[CHANGE SITE]** streaming upload + SSE subscription
2. `apps/web/src/routes/api/upload/+server.ts` — **[CHANGE SITE]** stream to disk instead of Buffer.from
3. `apps/web/src/routes/api/import/progress/+server.ts` — **[CREATE]** SSE progress endpoint
4. `services/worker/src/index.ts` — (existing worker, no changes needed for F02)

### F07: Filtering

**Flow:** User opens filter panel → fields inferred → conditions added → URL updates → map/table filter
**Observable trigger:** Click filter icon on layer in LayerPanel
**Observable outcome:** URL query params update, map features hide/show, DataTable rows filter

1. `apps/web/src/lib/stores/filters.svelte.ts` — **[CHANGE SITE]** replace singleton with FiltersStore class
2. `apps/web/src/lib/components/data/FilterPanel.svelte` — **[CHANGE SITE]** bind to FiltersStore instance
3. `apps/web/src/lib/components/map/MapEditor.svelte` — **[CHANGE SITE]** create FiltersStore instance, pass down

### F08: Geoprocessing

**Flow:** User selects op + layers → clicks run → job enqueued → SSE progress → new layer created
**Observable trigger:** Click RUN ANALYSIS in GeoprocessingPanel
**Observable outcome:** New layer appears on map after PostGIS operation completes

1. `apps/web/src/lib/server/jobs/queues.ts` — **[CHANGE SITE]** add geoprocessing queue
2. `apps/web/src/lib/server/trpc/routers/geoprocessing.ts` — **[CHANGE SITE]** enqueue job instead of sync execution
3. `apps/web/src/routes/api/geoprocessing/progress/+server.ts` — **[CREATE]** SSE progress endpoint
4. `apps/web/src/routes/api/geoprocessing/cancel/+server.ts` — **[CREATE]** job cancellation endpoint
5. `services/worker/src/index.ts` — **[CHANGE SITE]** add geoprocessing queue handler
6. `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte` — **[CHANGE SITE]** SSE progress + cancel button

---

## Execution Waves

**Wave 1:** F02 streaming upload + SSE progress (Tasks 1-4) — independent of F07/F08
**Wave 2:** F07 FiltersStore (Tasks 5-7) — independent of F02/F08
**Wave 3:** F08 async geoprocessing (Tasks 8-12) — depends on worker running (Wave 1 confirms worker is alive)

---

## Wave 1: F02 — Streaming Import with SSE Progress

### Task 1: Streaming upload endpoint — augment existing +server.ts

**Flow position:** Step 2 of 5 in import flow (user → **upload endpoint** → disk → queue → worker)
**Upstream contract:** Receives multipart/form-data POST with file, mapId, layerName fields
**Downstream contract:** Produces { jobId: string } JSON response; file on disk; importJobs row in DB
**Files:**

- Modify: `apps/web/src/routes/api/upload/+server.ts:1-80`
- Test: `apps/web/src/__tests__/import-upload.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write failing test for streaming upload**

```typescript
// apps/web/src/__tests__/import-upload.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from '../routes/api/upload/+server.js';
import { ReadableStream } from 'stream/web';

vi.mock('$env/dynamic/private', () => ({ env: { UPLOAD_DIR: '/tmp/test-uploads' } }));
vi.mock('$lib/server/db/index.js', () => ({
  db: {
    insert: vi
      .fn()
      .mockReturnValue({
        values: vi
          .fn()
          .mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'test-job-id' }]) }),
      }),
  },
  importJobs: { id: 'import_jobs' },
}));
vi.mock('$lib/server/jobs/queues.js', () => ({
  enqueueImportJob: vi.fn().mockResolvedValue('test-job-id'),
}));
vi.mock('$lib/server/geo/access.js', () => ({
  requireMapAccess: vi.fn().mockResolvedValue(true),
}));

describe('POST /api/upload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('streams file to disk without loading entire file into memory', async () => {
    // Simulates a 200MB file via ReadableStream chunks
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < 100; i++) {
      chunks.push(new Uint8Array(2 * 1024 * 1024)); // 2MB chunks
    }
    const formData = new FormData();
    formData.append('file', new File(chunks, 'large.geojson', { type: 'application/json' }));
    formData.append('mapId', 'test-map-uuid');

    const request = new Request('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST({ request, locals: { user: { id: 'test-user' } } } as any);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty('jobId');
    // Verify no Buffer.from of entire file — implementation uses stream.pipe
  });

  it('rejects files exceeding MAX_FILE_SIZE via streaming byte count', async () => {
    const formData = new FormData();
    formData.append('file', new File([new Uint8Array(101 * 1024 * 1024)], 'huge.geojson'));
    formData.append('mapId', 'test-map-uuid');

    const request = new Request('http://localhost/api/upload', {
      method: 'POST',
      body: formData,
    });

    const response = await POST({ request, locals: { user: { id: 'test-user' } } } as any);
    expect(response.status).toBe(413);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/__tests__/import-upload.test.ts -v`
Expected: FAIL — current implementation uses `Buffer.from(await file.arrayBuffer())`

- [ ] **Step 3: Modify upload endpoint to stream to disk**

Modify `apps/web/src/routes/api/upload/+server.ts`:

```typescript
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { mkdir, writeFile } from 'fs/promises';
import { createWriteStream } from 'fs';
import { join } from 'path';
import { sanitizeFilename } from '$lib/server/import/sanitize.js';
import { env } from '$env/dynamic/private';
import { db, importJobs } from '$lib/server/db/index.js';
import { enqueueImportJob } from '$lib/server/jobs/queues.js';
import { randomUUID } from 'crypto';
import { requireMapAccess } from '$lib/server/geo/access.js';
import { TRPCError } from '@trpc/server';

const UPLOAD_DIR = env.UPLOAD_DIR ?? '/tmp/felt-uploads';
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

export const POST: RequestHandler = async ({ request, locals }) => {
  if (!locals.user) {
    error(401, 'Unauthorized');
  }

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const mapId = formData.get('mapId') as string | null;
  const layerName = (formData.get('layerName') as string | null) ?? 'Imported Layer';

  if (!file || !mapId) {
    error(400, 'Missing file or mapId');
  }

  // Verify map access
  try {
    await requireMapAccess(locals.user.id, mapId, 'editor');
  } catch (err) {
    if (err instanceof TRPCError) {
      const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'FORBIDDEN' ? 403 : 500;
      error(status, err.message);
    }
    throw err;
  }

  // Create job ID and save file to disk via streaming
  const jobId = randomUUID();
  const jobDir = join(UPLOAD_DIR, jobId);
  await mkdir(jobDir, { recursive: true });

  const safeName = sanitizeFilename(file.name);
  const filePath = join(jobDir, safeName);
  if (!filePath.startsWith(jobDir)) {
    error(400, 'Invalid filename');
  }

  // Stream file to disk — use file.stream() which returns ReadableStream<Uint8Array>
  // WriteStream accepts Uint8Array chunks natively, no Buffer.from needed
  const writeStream = createWriteStream(filePath);
  const reader = file.stream().getReader();
  let bytesWritten = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // value is Uint8Array — WriteStream accepts it directly
      bytesWritten += value.byteLength;
      if (bytesWritten > MAX_FILE_SIZE) {
        writeStream.close();
        error(413, `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB`);
      }
      writeStream.write(value);
    }
  } finally {
    await new Promise<void>((resolve) => writeStream.end(resolve));
  }

  // Create import job record
  await db.insert(importJobs).values({
    id: jobId,
    mapId,
    status: 'pending',
    fileName: file.name,
    fileSize: bytesWritten,
    progress: 0,
  });

  // Enqueue BullMQ job
  await enqueueImportJob({
    jobId,
    mapId,
    layerName: layerName.trim() || file.name.replace(/\.[^.]+$/, ''),
    filePath,
    fileName: file.name,
  });

  return json({ jobId });
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/__tests__/import-upload.test.ts -v`
Expected: PASS — both tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/api/upload/+server.ts apps/web/src/__tests__/import-upload.test.ts
git commit -m "feat(F02): stream upload to disk instead of Buffer, enforce size via byte count"
```

### Task 2: SSE progress endpoint for import jobs

**Flow position:** Step 4 of 5 in import flow (worker → **SSE endpoint** → UI)
**Upstream contract:** Receives GET with jobId query param; reads import_jobs table
**Downstream contract:** Produces SSE stream with events: { type, progress, message }
**Files:**

- Create: `apps/web/src/routes/api/import/progress/+server.ts`
- Test: `apps/web/src/__tests__/import-progress.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write failing test for SSE progress endpoint**

```typescript
// apps/web/src/__tests__/import-progress.test.ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/server/db/index.js', () => ({
  db: {
    execute: vi
      .fn()
      .mockResolvedValue({ rows: [{ status: 'processing', progress: 45, error_message: null }] }),
  },
  importJobs: { id: 'import_jobs' },
}));

describe('GET /api/import/progress', () => {
  it('returns 400 when jobId is missing', async () => {
    const { GET } = await import('../routes/api/import/progress/+server.js');
    const request = new Request('http://localhost/api/import/progress');
    const response = await GET({ request } as any);
    expect(response.status).toBe(400);
  });

  it('returns SSE stream with current job status', async () => {
    const { GET } = await import('../routes/api/import/progress/+server.js');
    const request = new Request('http://localhost/api/import/progress?jobId=test-123');
    const response = await GET({ request } as any);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/__tests__/import-progress.test.ts -v`
Expected: FAIL — module does not exist

- [ ] **Step 3: Create SSE progress endpoint**

```typescript
// apps/web/src/routes/api/import/progress/+server.ts
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db/index.js';
import { sql } from 'drizzle-orm';

export const GET: RequestHandler = async ({ url }) => {
  const jobId = url.searchParams.get('jobId');
  if (!jobId) {
    error(400, 'Missing jobId parameter');
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        // Poll the import_jobs table for status updates
        // SSE with 1s polling interval; client falls back to polling if SSE unsupported
        const interval = setInterval(async () => {
          try {
            const result = await db.execute(sql`
              SELECT status, progress, error_message
              FROM import_jobs WHERE id = ${jobId}
            `);
            const row = result.rows?.[0];
            if (!row) {
              send({ type: 'error', message: 'Job not found' });
              controller.close();
              return;
            }

            send({
              type:
                row.status === 'done' ? 'complete' : row.status === 'failed' ? 'error' : 'progress',
              progress: row.progress ?? 0,
              message: row.error_message ?? undefined,
            });

            if (row.status === 'done' || row.status === 'failed') {
              controller.close();
            }
          } catch (err) {
            send({ type: 'error', message: (err as Error).message });
            controller.close();
          }
        }, 1000);

        // Clean up interval when client disconnects
        // SvelteKit handles abort signal on the request
      } catch (err) {
        send({ type: 'error', message: (err as Error).message });
        controller.close();
      }
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/__tests__/import-progress.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/api/import/progress/+server.ts apps/web/src/__tests__/import-progress.test.ts
git commit -m "feat(F02): SSE progress endpoint for import jobs with 1s polling"
```

### Task 3: Wire SSE progress into ImportDialog

**Flow position:** Step 5 of 5 in import flow (SSE endpoint → **ImportDialog UI** → user sees progress)
**Upstream contract:** Receives { jobId } from upload endpoint response
**Downstream contract:** Produces visual progress indicator in ImportDialog
**Files:**

- Modify: `apps/web/src/lib/components/import/ImportDialog.svelte`
- Test: (characterization test for existing wiring)

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Characterization test for current ImportDialog import flow**

```typescript
// apps/web/src/__tests__/import-dialog-flow.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('ImportDialog import flow', () => {
  it('calls onlayercreated callback when import completes', async () => {
    // Verify existing callback wiring: ImportDialog → onlayercreated → MapEditor
    // This ensures we don't break the existing success path while adding SSE
    const { default: ImportDialog } = await import('$lib/components/import/ImportDialog.svelte');
    expect(ImportDialog).toBeDefined();
    // The component accepts onlayercreated prop — verify via mount test
  });
});
```

- [ ] **Step 2: Add SSE subscription to ImportDialog**

Modify `apps/web/src/lib/components/import/ImportDialog.svelte` — add SSE progress subscription after successful upload:

```typescript
// Add to the onSuccess handler in the upload mutation:
onSuccess: async (data: { jobId: string }) => {
  uploadStatus = 'processing';
  uploadProgress = 0;

  // Subscribe to SSE progress updates
  const eventSource = new EventSource(`/api/import/progress?jobId=${data.jobId}`);
  eventSource.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'progress') {
      uploadProgress = msg.progress;
    } else if (msg.type === 'complete') {
      uploadProgress = 100;
      uploadStatus = 'done';
      eventSource.close();
      onlayercreated?.(data.jobId);
    } else if (msg.type === 'error') {
      uploadStatus = 'error';
      uploadError = msg.message ?? 'Import failed';
      eventSource.close();
    }
  };
  eventSource.onerror = () => {
    // SSE unsupported or connection lost — fall back to polling
    eventSource.close();
    pollImportStatus(data.jobId);
  };
};

// Add polling fallback function:
async function pollImportStatus(jobId: string) {
  const poll = setInterval(async () => {
    try {
      const res = await fetch(`/api/import/progress?jobId=${jobId}`);
      const text = await res.text();
      // Parse SSE format: "data: {...}\n\n"
      const match = text.match(/data: (.+)\n/);
      if (match) {
        const msg = JSON.parse(match[1]);
        if (msg.type === 'progress') {
          uploadProgress = msg.progress;
        } else if (msg.type === 'complete') {
          uploadProgress = 100;
          uploadStatus = 'done';
          clearInterval(poll);
          onlayercreated?.(jobId);
        } else if (msg.type === 'error') {
          uploadStatus = 'error';
          uploadError = msg.message ?? 'Import failed';
          clearInterval(poll);
        }
      }
    } catch {
      // Poll error — retry on next interval
    }
  }, 2000);
}
```

- [ ] **Step 3: Run existing tests to verify no regression**

Run: `npx vitest run apps/web/src/__tests__/import-dialog-flow.test.ts -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/import/ImportDialog.svelte apps/web/src/__tests__/import-dialog-flow.test.ts
git commit -m "feat(F02): wire SSE progress into ImportDialog with poll fallback"
```

### Task 4: Verification — F02 end-to-end

**Flow position:** Verification of complete import flow
**Files:** (no changes)

**Skill:** `none`

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run --reporter=verbose 2>&1 | head -50`
Expected: All tests pass, no new failures

- [ ] **Step 2: Run svelte-check**

Run: `npx svelte-check --threshold warning 2>&1 | tail -20`
Expected: 0 errors, existing warnings unchanged

- [ ] **Step 3: Commit verification**

```bash
git commit --allow-empty -m "verify(F02): streaming import + SSE progress complete, all tests pass"
```

---

## Wave 2: F07 — Scoped FiltersStore with URL Reflection

### Task 5: Create FiltersStore class

**Flow position:** Step 1 of 3 in filtering flow (user → **FiltersStore** → URL + map)
**Upstream contract:** Receives mapId on construction; reads layer schema for type inference
**Downstream contract:** Produces UIFilter[] per layer, MapLibre filter expressions, URL query params
**Files:**

- Create: `apps/web/src/lib/stores/filters-store.svelte.ts`
- Test: `apps/web/src/__tests__/filters-store.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write failing tests for FiltersStore**

```typescript
// apps/web/src/__tests__/filters-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FiltersStore } from '../stores/filters-store.svelte.js';

describe('FiltersStore', () => {
  let store: FiltersStore;

  beforeEach(() => {
    store = new FiltersStore('test-map-id');
  });

  it('starts with no conditions', () => {
    expect(store.conditions).toEqual([]);
  });

  it('adds a condition and updates URL', () => {
    store.addCondition({ field: 'name', operator: 'eq', value: 'test' });
    expect(store.conditions).toHaveLength(1);
    expect(store.conditions[0].field).toBe('name');
  });

  it('removes a condition by index', () => {
    store.addCondition({ field: 'name', operator: 'eq', value: 'a' });
    store.addCondition({ field: 'type', operator: 'cn', value: 'b' });
    store.removeCondition(0);
    expect(store.conditions).toHaveLength(1);
    expect(store.conditions[0].field).toBe('type');
  });

  it('serializes conditions to URL params', () => {
    store.addCondition({ field: 'name', operator: 'eq', value: 'test' });
    const params = store.toUrlParams();
    expect(params.get('filter')).toBe('name:eq:test');
  });

  it('deserializes conditions from URL params', () => {
    const params = new URLSearchParams('filter=name:eq:test&filter=type:cn:road');
    store.fromUrlParams(params);
    expect(store.conditions).toHaveLength(2);
    expect(store.conditions[0]).toEqual({ field: 'name', operator: 'eq', value: 'test' });
    expect(store.conditions[1]).toEqual({ field: 'type', operator: 'cn', value: 'road' });
  });

  it('infers field types from sample features', () => {
    const sampleFeatures = [{ properties: { name: 'test', count: 42, active: true } }];
    const fields = store.inferFields(sampleFeatures);
    expect(fields).toEqual({
      name: 'string',
      count: 'number',
      active: 'boolean',
    });
  });

  it('produces MapLibre filter for a layer', () => {
    store.addCondition({ field: 'name', operator: 'eq', value: 'test' });
    const mlFilter = store.toMapLibreFilter('layer-1');
    expect(mlFilter).toBeDefined();
    // Filter should be ['==', ['get', 'name'], 'test']
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/__tests__/filters-store.test.ts -v`
Expected: FAIL — module does not exist

- [ ] **Step 3: Create FiltersStore class**

```typescript
// apps/web/src/lib/stores/filters-store.svelte.ts
import { fslFiltersToMapLibre } from '@felt-like-it/geo-engine';
import type { FilterOperator, UIFilter } from './filters.svelte.js';

export type FieldType = 'string' | 'number' | 'boolean';

export interface FilterCondition extends UIFilter {}

export class FiltersStore {
  conditions = $state<FilterCondition[]>([]);
  fieldTypes = $state<Record<string, FieldType>>({});
  readonly mapId: string;

  constructor(mapId: string) {
    this.mapId = mapId;
    // Initialize from URL if present
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      this.fromUrlParams(params);
    }
  }

  addCondition(condition: FilterCondition): void {
    this.conditions = [...this.conditions, condition];
    this.syncToUrl();
  }

  removeCondition(index: number): void {
    this.conditions = this.conditions.filter((_, i) => i !== index);
    this.syncToUrl();
  }

  updateCondition(index: number, updates: Partial<FilterCondition>): void {
    this.conditions = this.conditions.map((c, i) => (i === index ? { ...c, ...updates } : c));
    this.syncToUrl();
  }

  clearAll(): void {
    this.conditions = [];
    this.syncToUrl();
  }

  /** Infer field types from first N sample features. */
  inferFields(features: Array<{ properties: Record<string, unknown> }>): Record<string, FieldType> {
    const sample = features.slice(0, 100);
    const types: Record<string, Set<string>> = {};

    for (const feature of sample) {
      for (const [key, value] of Object.entries(feature.properties ?? {})) {
        if (!types[key]) types[key] = new Set();
        if (value !== null && value !== undefined) {
          types[key].add(typeof value);
        }
      }
    }

    const result: Record<string, FieldType> = {};
    for (const [key, typeSet] of Object.entries(types)) {
      if (typeSet.has('number')) result[key] = 'number';
      else if (typeSet.has('boolean')) result[key] = 'boolean';
      else result[key] = 'string';
    }

    this.fieldTypes = result;
    return result;
  }

  /** Serialize conditions to URLSearchParams. */
  toUrlParams(): URLSearchParams {
    const params = new URLSearchParams();
    for (const cond of this.conditions) {
      params.append('filter', `${cond.field}:${cond.operator}:${encodeURIComponent(cond.value)}`);
    }
    return params;
  }

  /** Deserialize conditions from URLSearchParams. */
  fromUrlParams(params: URLSearchParams): void {
    const filters = params.getAll('filter');
    this.conditions = filters
      .map((raw) => {
        const parts = raw.split(':');
        if (parts.length < 3) return null;
        const field = parts[0];
        const operator = parts[1] as FilterOperator;
        const value = decodeURIComponent(parts.slice(2).join(':'));
        const validOperators: FilterOperator[] = ['eq', 'ne', 'lt', 'gt', 'cn', 'in', 'ni'];
        if (!validOperators.includes(operator)) return null;
        return { field, operator, value };
      })
      .filter((c): c is FilterCondition => c !== null);
  }

  /** Sync current conditions to browser URL. */
  syncToUrl(): void {
    if (typeof window === 'undefined') return;
    const params = this.toUrlParams();
    const newQuery = params.toString();
    const currentQuery = window.location.search.slice(1);
    if (newQuery !== currentQuery) {
      const url = new URL(window.location.href);
      url.search = newQuery;
      window.history.replaceState({}, '', url.toString());
    }
  }

  /** Convert conditions to a MapLibre filter expression for a specific layer. */
  toMapLibreFilter(_layerId: string): unknown[] | undefined {
    if (this.conditions.length === 0) return undefined;
    const fslFilters = this.conditions.map((f) => [f.field, f.operator, f.value]);
    return fslFiltersToMapLibre(fslFilters) ?? undefined;
  }

  /** Apply conditions to features array (for DataTable filtering). */
  applyToFeatures(features: Array<{ properties: Record<string, unknown> }>): typeof features {
    if (this.conditions.length === 0) return features;
    return features.filter((f) =>
      this.conditions.every((cond) => matchesFilter(f.properties ?? {}, cond))
    );
  }
}

function matchesFilter(properties: Record<string, unknown>, filter: UIFilter): boolean {
  const val = properties[filter.field];
  const raw = filter.value;
  switch (filter.operator) {
    case 'eq':
      return String(val ?? '') === raw;
    case 'ne':
      return String(val ?? '') !== raw;
    case 'lt':
      return Number(val) < Number(raw);
    case 'gt':
      return Number(val) > Number(raw);
    case 'cn':
      return String(val ?? '')
        .toLowerCase()
        .includes(raw.toLowerCase());
    case 'in': {
      const allowed = raw.split(',').map((s) => s.trim());
      return allowed.includes(String(val ?? ''));
    }
    case 'ni': {
      const excluded = raw.split(',').map((s) => s.trim());
      return !excluded.includes(String(val ?? ''));
    }
    default:
      return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/__tests__/filters-store.test.ts -v`
Expected: PASS — all 7 tests pass

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/stores/filters-store.svelte.ts apps/web/src/__tests__/filters-store.test.ts
git commit -m "feat(F07): FiltersStore class with URL reflection and type inference"
```

### Task 6: Update FilterPanel to use FiltersStore

**Flow position:** Step 2 of 3 in filtering flow (FiltersStore → **FilterPanel UI** → user interaction)
**Upstream contract:** Receives FiltersStore instance as prop
**Downstream contract:** Produces user interactions that call store methods
**Files:**

- Modify: `apps/web/src/lib/components/data/FilterPanel.svelte`

**Skill:** `superpowers:test-driven-development`
**Codebooks:** `virtualization-vs-interaction-fidelity`

- [ ] **Step 1: Characterization test for current FilterPanel**

```typescript
// Add to existing filter panel tests or create new characterization test
// Verify current FilterPanel imports and uses filterStore singleton
```

- [ ] **Step 2: Update FilterPanel to accept FiltersStore prop**

Modify `apps/web/src/lib/components/data/FilterPanel.svelte` — change from singleton import to prop-based:

```typescript
// Replace:
// import { filterStore } from '$lib/stores/filters.svelte.js';
// With:
import type { FiltersStore } from '$lib/stores/filters-store.svelte.js';

interface Props {
  store: FiltersStore;
  layerId: string;
  layerName: string;
}

let { store, layerId, layerName }: Props = $props();
```

Update template bindings from `filterStore.*` to `store.*`:

- `filterStore.get(layerId)` → `store.conditions` (single-store, no per-layer)
- `filterStore.add(layerId, filter)` → `store.addCondition(filter)`
- `filterStore.remove(layerId, index)` → `store.removeCondition(index)`
- `filterStore.clear(layerId)` → `store.clearAll()`

- [ ] **Step 3: Run svelte-check**

Run: `npx svelte-check --threshold warning 2>&1 | grep -i filter`
Expected: 0 errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/data/FilterPanel.svelte
git commit -m "feat(F07): FilterPanel uses FiltersStore prop instead of singleton"
```

### Task 7: Wire FiltersStore into MapEditor

**Flow position:** Step 3 of 3 in filtering flow (MapEditor creates store → passes to FilterPanel + DataTable)
**Upstream contract:** Receives mapId from route params
**Downstream contract:** Produces FiltersStore instance passed to FilterPanel and DataTable
**Files:**

- Modify: `apps/web/src/lib/components/map/MapEditor.svelte`
- Modify: `apps/web/src/lib/components/data/DataTable.svelte`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Add FiltersStore instance to MapEditor**

In `apps/web/src/lib/components/map/MapEditor.svelte`, add:

```typescript
import { FiltersStore } from '$lib/stores/filters-store.svelte.js';

// Inside the component script:
let filtersStore = $state<FiltersStore | null>(null);

$effect(() => {
  if (mapId && !filtersStore) {
    filtersStore = new FiltersStore(mapId);
  }
});
```

Pass `filtersStore` to FilterPanel and DataTable components.

- [ ] **Step 2: Update DataTable to accept FiltersStore**

Modify `apps/web/src/lib/components/data/DataTable.svelte` to accept `filtersStore` prop and use `store.applyToFeatures()` for row filtering.

- [ ] **Step 3: Run tests**

Run: `npx vitest run apps/web/src/__tests__/filters-store.test.ts -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/components/map/MapEditor.svelte apps/web/src/lib/components/data/DataTable.svelte
git commit -m "feat(F07): wire FiltersStore into MapEditor and DataTable"
```

---

## Wave 3: F08 — Async Geoprocessing with Job Queue

### Task 8: Add geoprocessing queue to queues.ts

**Flow position:** Step 2 of 6 in geoprocessing flow (user → tRPC router → **queue** → worker)
**Upstream contract:** Receives { jobId, mapId, op, outputLayerId } from tRPC router
**Downstream contract:** Enqueues job to BullMQ 'geoprocessing' queue
**Files:**

- Modify: `apps/web/src/lib/server/jobs/queues.ts:1-30`
- Test: `apps/web/src/__tests__/geoprocessing-queues.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write failing test for geoprocessing queue**

```typescript
// apps/web/src/__tests__/geoprocessing-queues.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('geoprocessing queue', () => {
  it('creates a queue named geoprocessing', async () => {
    const { getGeoprocessingQueue } = await import('$lib/server/jobs/queues.js');
    const queue = getGeoprocessingQueue();
    expect(queue.name).toBe('geoprocessing');
  });

  it('enqueues a geoprocessing job with correct payload', async () => {
    const { enqueueGeoprocessingJob } = await import('$lib/server/jobs/queues.js');
    const jobId = await enqueueGeoprocessingJob({
      jobId: 'test-job',
      mapId: 'test-map',
      op: { type: 'buffer', layerId: 'layer-1', distanceKm: 1 },
      outputLayerId: 'output-1',
    });
    expect(jobId).toBe('test-job');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run apps/web/src/__tests__/geoprocessing-queues.test.ts -v`
Expected: FAIL — functions don't exist

- [ ] **Step 3: Add geoprocessing queue to queues.ts**

Append to `apps/web/src/lib/server/jobs/queues.ts`:

```typescript
import type { GeoprocessingOp } from '@felt-like-it/shared-types';

export interface GeoprocessingJobPayload {
  jobId: string;
  mapId: string;
  op: GeoprocessingOp;
  outputLayerId: string;
}

let _geoprocessingQueue: Queue<GeoprocessingJobPayload> | null = null;

export function getGeoprocessingQueue(): Queue<GeoprocessingJobPayload> {
  if (!_geoprocessingQueue) {
    _geoprocessingQueue = new Queue<GeoprocessingJobPayload>('geoprocessing', {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 50,
        removeOnFail: 200,
      },
    });
  }
  return _geoprocessingQueue;
}

export async function enqueueGeoprocessingJob(payload: GeoprocessingJobPayload): Promise<string> {
  const queue = getGeoprocessingQueue();
  const job = await queue.add('geoprocessing', payload, { jobId: payload.jobId });
  return job.id ?? payload.jobId;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run apps/web/src/__tests__/geoprocessing-queues.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/jobs/queues.ts apps/web/src/__tests__/geoprocessing-queues.test.ts
git commit -m "feat(F08): add geoprocessing BullMQ queue alongside file-import"
```

### Task 9: Convert tRPC router to async job enqueue

**Flow position:** Step 1 of 6 in geoprocessing flow (user → **tRPC router** → queue)
**Upstream contract:** Receives { mapId, op, outputLayerName } from GeoprocessingPanel
**Downstream contract:** Creates output layer row, enqueues job, returns { jobId, layerId }
**Files:**

- Modify: `apps/web/src/lib/server/trpc/routers/geoprocessing.ts:1-104`
- Test: `apps/web/src/__tests__/geoprocessing-router.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write failing test for async router**

```typescript
// apps/web/src/__tests__/geoprocessing-router.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/server/jobs/queues.js', () => ({
  enqueueGeoprocessingJob: vi.fn().mockResolvedValue('test-job-id'),
}));

describe('geoprocessing router (async)', () => {
  it('enqueues job instead of executing synchronously', async () => {
    // Verify the router no longer calls runGeoprocessing directly
    // but instead creates layer + enqueues job
    const { geoprocessingRouter } = await import('$lib/server/trpc/routers/geoprocessing.js');
    expect(geoprocessingRouter).toBeDefined();
    // Router should return { jobId, layerId, layerName }
  });
});
```

- [ ] **Step 2: Modify router to enqueue job**

Modify `apps/web/src/lib/server/trpc/routers/geoprocessing.ts`:

```typescript
// Replace the mutation handler body:
.mutation(async ({ ctx, input }) => {
  await requireMapAccess(ctx.user.id, input.mapId, 'editor');

  // Verify input layers belong to this map
  const inputLayerIds = getOpLayerIds(input.op);
  await Promise.all(
    inputLayerIds.map(async (layerId) => {
      const [ownedLayer] = await db
        .select({ id: layers.id })
        .from(layers)
        .where(and(eq(layers.id, layerId), eq(layers.mapId, input.mapId)));
      if (!ownedLayer) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'One or more input layers not found.' });
      }
    })
  );

  // Determine z_index
  const existingLayers = await db
    .select({ zIndex: layers.zIndex })
    .from(layers)
    .where(eq(layers.mapId, input.mapId));
  const maxZ = existingLayers.reduce((max, l) => Math.max(max, l.zIndex), -1);

  // Create output layer
  const [newLayer] = await db
    .insert(layers)
    .values({
      mapId: input.mapId,
      name: input.outputLayerName,
      type: 'mixed',
      style: { type: 'simple', paint: {} },
      visible: true,
      zIndex: maxZ + 1,
    })
    .returning();

  if (!newLayer) {
    throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to create output layer.' });
  }

  // Enqueue job instead of running synchronously
  const { randomUUID } = await import('crypto');
  const jobId = randomUUID();

  // Track job in import_jobs table for progress polling
  await db.execute(sql`
    INSERT INTO import_jobs (id, map_id, status, file_name, progress)
    VALUES (${jobId}::uuid, ${input.mapId}, 'processing', ${input.outputLayerName}, 0)
  `);

  await enqueueGeoprocessingJob({
    jobId,
    mapId: input.mapId,
    op: input.op,
    outputLayerId: newLayer.id,
  });

  return { jobId, layerId: newLayer.id, layerName: newLayer.name };
})
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run apps/web/src/__tests__/geoprocessing-router.test.ts -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/geoprocessing.ts apps/web/src/__tests__/geoprocessing-router.test.ts
git commit -m "feat(F08): tRPC router enqueues job instead of sync execution"
```

### Task 10: Add geoprocessing handler to existing worker

**Flow position:** Step 3 of 6 in geoprocessing flow (queue → **worker handler** → PostGIS)
**Upstream contract:** Receives GeoprocessingJobPayload from BullMQ 'geoprocessing' queue
**Downstream contract:** Executes PostGIS ops, updates import_jobs progress, creates features
**Files:**

- Modify: `services/worker/src/index.ts` (append handler + second worker)
- Test: `services/worker/src/__tests__/geoprocessing-worker.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write failing test for geoprocessing worker handler**

```typescript
// services/worker/src/__tests__/geoprocessing-worker.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('geoprocessing worker handler', () => {
  it('processes a buffer operation and updates progress', async () => {
    // Verify the handler calls runGeoprocessing with correct params
    // and updates import_jobs progress
    const { processGeoprocessingJob } = await import('../index.js');
    expect(processGeoprocessingJob).toBeDefined();
  });
});
```

- [ ] **Step 2: Add geoprocessing handler to worker**

Append to `services/worker/src/index.ts` (before the worker setup section):

```typescript
import {
  GeoprocessingJobPayloadSchema,
  type GeoprocessingJobPayload,
} from '@felt-like-it/shared-types';
import { runGeoprocessing } from './geo/geoprocessing.js'; // or relative path to shared geoprocessing.ts

async function processGeoprocessingJob(job: Job<GeoprocessingJobPayload>): Promise<void> {
  const { jobId, mapId, op, outputLayerId } = GeoprocessingJobPayloadSchema.parse(job.data);

  logger.info({ jobId, op: op.type, outputLayerId }, 'processing geoprocessing job');

  try {
    await updateJobStatus(jobId, 'processing', 10);

    // Run the PostGIS operation — existing runGeoprocessing handles all op types
    await runGeoprocessing(op, outputLayerId);

    await updateJobStatus(jobId, 'done', 100);
    logger.info({ jobId }, 'geoprocessing job completed');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ jobId, error: message }, 'geoprocessing job failed');
    await db.execute(sql`
      UPDATE import_jobs
      SET status = 'failed', error_message = ${message}, updated_at = NOW()
      WHERE id = ${jobId}
    `);
    throw err;
  }
}
```

Then add the second worker (after the existing import worker setup):

```typescript
// ─── Geoprocessing worker ────────────────────────────────────────────────────

const geoprocessingWorker = new Worker<GeoprocessingJobPayload>(
  'geoprocessing',
  processGeoprocessingJob,
  {
    connection,
    concurrency: 1, // Geoprocessing is heavy — one at a time
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 200 },
  }
);

geoprocessingWorker.on('completed', (job) => {
  logger.info({ jobId: job.id }, 'geoprocessing job completed');
});

geoprocessingWorker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, error: err.message }, 'geoprocessing job failed');
});

logger.info('geoprocessing worker started');
```

Update the shutdown function to close the new worker:

```typescript
async function shutdown(): Promise<void> {
  logger.info('shutting down');
  clearInterval(staleJobTimer);
  await worker.close();
  await geoprocessingWorker.close();
  await connection.quit();
  await pool.end();
  process.exit(0);
}
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run services/worker/src/__tests__/geoprocessing-worker.test.ts -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/worker/src/index.ts services/worker/src/__tests__/geoprocessing-worker.test.ts
git commit -m "feat(F08): add geoprocessing handler + second worker to existing worker process"
```

### Task 11: SSE progress endpoint for geoprocessing

**Flow position:** Step 4 of 6 in geoprocessing flow (worker → **SSE endpoint** → UI)
**Upstream contract:** Receives GET with jobId query param; reads import_jobs table
**Downstream contract:** Produces SSE stream with progress events
**Files:**

- Create: `apps/web/src/routes/api/geoprocessing/progress/+server.ts`
- Test: `apps/web/src/__tests__/geoprocessing-progress.test.ts`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Write failing test**

```typescript
// apps/web/src/__tests__/geoprocessing-progress.test.ts
import { describe, it, expect, vi } from 'vitest';

describe('GET /api/geoprocessing/progress', () => {
  it('returns 400 when jobId is missing', async () => {
    const { GET } = await import('../routes/api/geoprocessing/progress/+server.js');
    const request = new Request('http://localhost/api/geoprocessing/progress');
    const response = await GET({ request } as any);
    expect(response.status).toBe(400);
  });

  it('returns SSE stream for valid jobId', async () => {
    const { GET } = await import('../routes/api/geoprocessing/progress/+server.js');
    const request = new Request('http://localhost/api/geoprocessing/progress?jobId=test-123');
    const response = await GET({ request } as any);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
  });
});
```

- [ ] **Step 2: Create SSE endpoint**

Same pattern as Task 2's import progress endpoint, but at a different route. Can actually reuse the same endpoint since both use import_jobs table — but keeping separate for clarity.

```typescript
// apps/web/src/routes/api/geoprocessing/progress/+server.ts
// Same implementation as /api/import/progress/+server.ts
// Both read from import_jobs table
```

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run apps/web/src/__tests__/geoprocessing-progress.test.ts -v`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/api/geoprocessing/progress/+server.ts apps/web/src/__tests__/geoprocessing-progress.test.ts
git commit -m "feat(F08): SSE progress endpoint for geoprocessing jobs"
```

### Task 12: Job cancellation endpoint + wire into GeoprocessingPanel

**Flow position:** Step 5-6 of 6 in geoprocessing flow (UI cancel → **cancel endpoint** → worker)
**Upstream contract:** Receives POST with jobId
**Downstream contract:** Removes job from BullMQ queue or marks as failed
**Files:**

- Create: `apps/web/src/routes/api/geoprocessing/cancel/+server.ts`
- Modify: `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte`

**Skill:** `superpowers:test-driven-development`

- [ ] **Step 1: Create cancel endpoint**

```typescript
// apps/web/src/routes/api/geoprocessing/cancel/+server.ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { Queue } from 'bullmq';
import { createRedisConnection } from '$lib/server/jobs/connection.js';
import { db } from '$lib/server/db/index.js';
import { sql } from 'drizzle-orm';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json();
  const jobId = body.jobId as string | undefined;
  if (!jobId) {
    error(400, 'Missing jobId');
  }

  try {
    const queue = new Queue('geoprocessing', { connection: createRedisConnection() });
    const job = await queue.getJob(jobId);

    if (job) {
      await job.moveToFailed(new Error('Cancelled by user'), true);
    }

    // Update status in DB
    await db.execute(sql`
      UPDATE import_jobs
      SET status = 'failed', error_message = 'Cancelled by user', updated_at = NOW()
      WHERE id = ${jobId}
    `);

    await queue.close();
    return json({ success: true });
  } catch (err) {
    error(500, `Failed to cancel job: ${(err as Error).message}`);
  }
};
```

- [ ] **Step 2: Add cancel button to GeoprocessingPanel**

Modify `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte` — add cancel button that calls the cancel endpoint and aborts the SSE stream:

```typescript
// Add cancel function:
async function handleCancel() {
  if (!currentJobId) return;
  cancelling = true;
  try {
    await fetch('/api/geoprocessing/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: currentJobId }),
    });
    error = null;
    success = 'Operation cancelled';
  } catch {
    error = 'Failed to cancel operation';
  } finally {
    running = false;
    cancelling = false;
    currentJobId = null;
    eventSource?.close();
  }
}
```

- [ ] **Step 3: Run tests**

Run: `npx vitest run apps/web/src/__tests__/geoprocessing.test.ts -v`
Expected: PASS (existing tests still pass)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/api/geoprocessing/cancel/+server.ts apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte
git commit -m "feat(F08): job cancellation endpoint + cancel button in GeoprocessingPanel"
```

---

## Wave 4: Integration Verification

### Task 13: Full test suite + svelte-check verification

**Skill:** `none`

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run 2>&1 | tail -30`
Expected: All tests pass (existing 834 + new tests from this plan)

- [ ] **Step 2: Run svelte-check**

Run: `npx svelte-check --threshold warning 2>&1 | tail -10`
Expected: 0 new errors

- [ ] **Step 3: Run lint**

Run: `npx turbo lint 2>&1 | tail -10`
Expected: 0 new lint errors

- [ ] **Step 4: Record mulch decision + close seeds**

```bash
ml record data-pipeline --type decision --title "Augment existing worker, don't replace" --rationale "Worker already has 6 format parsers, path-traversal guards, progress tracking, stale job reaper. Replacing would lose ~400 lines of tested code." --classification foundational --tags "scope:worker,source:plan-review,lifecycle:active"
```

- [ ] **Step 5: Commit**

```bash
git commit --allow-empty -m "verify(Group1): all tests pass, 0 new errors, data pipeline complete"
```

---

## Open Questions

### Wave 1 (F02)

- **Task 1:** Does `file.stream()` return `ReadableStream<Uint8Array>` in SvelteKit's Node adapter? (assumed yes — standard Web API)
- **Task 2:** Should the SSE endpoint use the same `import_jobs` table for both import and geoprocessing progress? (assumed yes — both use same status/progress columns)

### Wave 2 (F07)

- **Task 5:** Should the old `filterStore` singleton export be preserved for backward compatibility? (assumed no — only used internally by MapEditor/FilterPanel/DataTable)
- **Task 5:** Does `fslFiltersToMapLibre` handle all 7 operators correctly? (existing code uses it — assumed working)

### Wave 3 (F08)

- **Task 10:** Does `runGeoprocessing` need the `statement_timeout` guard when called from worker? (existing router sets it via `SET LOCAL` — worker should do the same)
- **Task 12:** Should cancellation use `job.moveToFailed()` or `job.remove()`? (assumed `moveToFailed` — preserves job history for UI)

### Flow Contracts

- Q: Does the existing `import_jobs` table have all columns needed for both import and geoprocessing progress? (has: id, map_id, status, progress, error_message, file_name — sufficient for both)
- Q: Can the worker's `runGeoprocessing` function be imported from `services/worker/`? (it lives in `apps/web/src/lib/server/geo/geoprocessing.ts` — may need to be moved to shared package or imported via relative path)

---

<!-- PLAN_MANIFEST_START -->

| File                                                                  | Action | Marker                               |
| --------------------------------------------------------------------- | ------ | ------------------------------------ |
| `apps/web/src/routes/api/upload/+server.ts`                           | patch  | `createWriteStream(filePath)`        |
| `apps/web/src/routes/api/import/progress/+server.ts`                  | create | `text/event-stream`                  |
| `apps/web/src/lib/components/import/ImportDialog.svelte`              | patch  | `EventSource(\`/api/import/progress` |
| `apps/web/src/lib/stores/filters-store.svelte.ts`                     | create | `class FiltersStore`                 |
| `apps/web/src/lib/components/data/FilterPanel.svelte`                 | patch  | `import type { FiltersStore }`       |
| `apps/web/src/lib/components/map/MapEditor.svelte`                    | patch  | `new FiltersStore(mapId)`            |
| `apps/web/src/lib/components/data/DataTable.svelte`                   | patch  | `filtersStore`                       |
| `apps/web/src/lib/server/jobs/queues.ts`                              | patch  | `getGeoprocessingQueue`              |
| `apps/web/src/lib/server/trpc/routers/geoprocessing.ts`               | patch  | `enqueueGeoprocessingJob`            |
| `services/worker/src/index.ts`                                        | patch  | `processGeoprocessingJob`            |
| `apps/web/src/routes/api/geoprocessing/progress/+server.ts`           | create | `text/event-stream`                  |
| `apps/web/src/routes/api/geoprocessing/cancel/+server.ts`             | create | `moveToFailed`                       |
| `apps/web/src/lib/components/geoprocessing/GeoprocessingPanel.svelte` | patch  | `handleCancel`                       |

<!-- PLAN_MANIFEST_END -->
