# Data Pipeline: Inter-Subsystem Contracts

> Characterizes every interface between the data-pipeline and adjacent subsystems.
> Each section traces the exact contract shape, identifies gaps, and notes risks.

---

## 1. Web <-> Worker Boundary (BullMQ / Redis)

### Queue Topology

| Property | Value |
|---|---|
| Queue name | `file-import` |
| Job name | `import` |
| Concurrency | 3 (worker side) |
| Retry | 3 attempts, exponential backoff starting at 2s |
| Retention | `removeOnComplete: 100`, `removeOnFail: 500` |

**Web-side producer** (`apps/web/src/lib/server/jobs/queues.ts:19-25`):
- Lazily creates a singleton `Queue<ImportJobPayload>` instance.
- `enqueueImportJob(payload)` adds the job with `jobId` as BullMQ's `jobId` (dedup key).

**Worker-side consumer** (`services/worker/src/index.ts:648-651`):
- Creates a `Worker<ImportJobPayload>('file-import', processImportJob, { concurrency: 3 })`.
- Uses its own ioredis connection, not the web app's.

### ImportJobPayload Schema

Defined in `packages/shared-types/src/schemas/job.ts:17-23`:

```typescript
ImportJobPayloadSchema = z.object({
  jobId:     z.string().uuid(),
  mapId:     z.string().uuid(),
  layerName: z.string(),
  filePath:  z.string(),   // absolute path on shared filesystem
  fileName:  z.string(),   // original user-supplied filename
});
```

### Job Status Polling

The web app polls job status via a **plain SvelteKit endpoint** (not tRPC):

- **`GET /api/job/[jobId]`** (`apps/web/src/routes/api/job/[jobId]/+server.ts`)
- Reads from the `import_jobs` PostgreSQL table (not from Redis/BullMQ).
- Returns: `{ id, status, progress, layerId, errorMessage, fileName }`.
- Auth: requires `editor+` access to the job's map via `requireMapAccess`.

**Status flow**: `pending` -> `processing` (worker picks up) -> `done` | `failed`.
Progress is 0-100 integer, updated by the worker via raw SQL.

### Redis Connection Contract

| Side | Source | Config |
|---|---|---|
| Web | `apps/web/src/lib/server/jobs/connection.ts` | `$env/dynamic/private.REDIS_URL` (SvelteKit env) |
| Worker | `services/worker/src/index.ts` | `process.env['REDIS_URL']` (Node env) |

Both use `maxRetriesPerRequest: null` and `enableReadyCheck: false` (BullMQ requirements).

**Risk**: Two independent Redis connection factories. If one changes options (e.g., TLS config), the other silently diverges.

---

## 2. Worker <-> Database Boundary

### Dual Database Access Pattern

The worker uses **drizzle-orm's `sql` tagged template** for raw SQL but does NOT use the schema definitions or table objects from the web app. It creates its own `pg.Pool` and `drizzle(pool)` instance.

**Web app path** (`apps/web/src/lib/server/import/shared.ts`, `apps/web/src/lib/server/geo/queries.ts`):
- Uses Drizzle ORM table objects (`db.insert(layers)`, `db.update(importJobs)`)
- Validates via Zod schemas before insert
- Calls `invalidateLayer()` after inserts to bust the GeoJSON cache

**Worker path** (`services/worker/src/index.ts`):
- All SQL is raw via `db.execute(sql\`...\`)`
- No Zod validation of parsed features before insert
- No `invalidateLayer()` call -- GeoJSON cache may serve stale data until TTL expires
- No transaction wrapping -- partial inserts are possible on crash

### SQL Patterns in the Worker

1. **Layer creation**: `INSERT INTO layers (map_id, name, type, style, source_file_name) VALUES (...) RETURNING id`
2. **Job status update**: `UPDATE import_jobs SET status = $1, progress = $2, updated_at = NOW() WHERE id = $3`
3. **Feature insert (GeoJSON path)**: `INSERT INTO features (layer_id, geometry, properties) VALUES (uuid, ST_GeomFromGeoJSON(...), jsonb)`
4. **Feature insert (WKB path, GeoPackage)**: `INSERT INTO features (layer_id, geometry, properties) VALUES (uuid, ST_GeomFromWKB(decode(hex, 'hex'), srid), jsonb)` with optional `ST_Transform` for non-4326 SRIDs.

### Validation Gap

| Check | Web (ORM path) | Worker (raw SQL) |
|---|---|---|
| Geometry Zod schema | Yes (via shared-types) | No -- relies on PostGIS `ST_GeomFromGeoJSON` to reject invalid |
| Properties JSONB | Typed via Drizzle schema | `JSON.stringify()` directly -- no size or depth limit |
| Layer type enum | Drizzle enum constraint | String literal passed to SQL |
| Feature count limit | None | None |
| File size limit | 100MB (upload route) | No re-check |

---

## 3. Filesystem Contract

### Path Convention

```
UPLOAD_DIR / {jobId} / {sanitized-filename}
```

- `UPLOAD_DIR` defaults to `/tmp/felt-uploads` (configurable via `UPLOAD_DIR` env var).
- Each job gets its own subdirectory named by UUID.
- Filename sanitized via `sanitize.ts`: strips directory components, replaces unsafe chars, collapses `..` to `__`.
- Defense-in-depth: resolved path checked with `startsWith(jobDir)`.

### Lifecycle

| Phase | Actor | Action |
|---|---|---|
| Write | Web upload route | `mkdir(jobDir, { recursive: true })` + `writeFile(filePath, buffer)` |
| Read | Worker process | `readFile(filePath)` or `createReadStream(filePath)` |
| Delete | **Nobody** | No cleanup exists |

**Critical gap**: Upload files are **never deleted**. No cleanup on job completion, failure, or expiry. The `/tmp/felt-uploads` directory will grow unboundedly in production.

### Crash Recovery

- BullMQ retries (3 attempts) will re-read the same file from disk since the jobId subdirectory persists.
- The web import path (`apps/web/src/lib/server/import/index.ts:30-34`) has `cleanupPreviousAttempt()` that deletes any partially-created layer before re-import.
- The worker does NOT call `cleanupPreviousAttempt` -- it has its own inline error handling that sets `status = 'failed'` but does not clean up the partial layer.

**Risk**: Worker retry after partial insert could create duplicate layers since the worker lacks the web app's `cleanupPreviousAttempt` guard.

---

## 4. geo-engine Package Boundary

### Package Identity

- **Package**: `@felt-like-it/geo-engine` (`packages/geo-engine/`)
- **Dependency**: `@turf/turf ^7.1.0`, `@felt-like-it/shared-types workspace:*`
- **1335 LOC** across 10 source modules + 9 test files.

### Exported API Surface

From `packages/geo-engine/src/index.ts` (barrel re-export of all modules):

| Module | Key Exports | LOC | Consumers |
|---|---|---|---|
| `detect.ts` | `detectCoordinateColumns`, `detectAddressColumn`, `isValidLatitude`, `isValidLongitude`, `detectLayerType`, `detectGeometryType`, `isCategoricalColumn`, `isNumericColumn`, `getUniqueValues` | 181 | Web import (csv.ts), Worker |
| `validate.ts` | `validateGeoJSON` | 128 | Web import (geojson.ts), Worker |
| `auto-style.ts` | `generateAutoStyle` | 304 | Web import (shared.ts), Worker |
| `geocode.ts` | `geocodeBatch`, `GeocodingOptions` | 112 | Web import (csv.ts), Worker |
| `transform.ts` | coordinate transforms | 84 | Internal |
| `classify.ts` | classification methods | 56 | Auto-style |
| `color-ramps.ts` | color ramp definitions | 49 | Auto-style |
| `filters.ts` | feature filters | 100 | Client-side |
| `interpolators.ts` | interpolation functions | 157 | Client-side |
| `measurement.ts` | distance/area calculations | 154 | Client-side |

### Stability Assessment

- **Stable**: The interface is a flat barrel export. No versioned API.
- **Risk**: Both web and worker import the same functions but the worker also duplicates the *calling patterns* (parse -> detect -> style -> insert). Changes to geo-engine's API require updating both consumers.
- The package has **zero** runtime dependencies beyond `@turf/turf` -- clean boundary.

---

## 5. tRPC Contract

### Import/Export tRPC Routes

Import and export do **not** use tRPC. They use plain SvelteKit API routes:

| Endpoint | Method | Purpose | Auth |
|---|---|---|---|
| `/api/upload` | POST | Multipart file upload, creates import job | `requireMapAccess(editor+)` |
| `/api/job/[jobId]` | GET | Poll import job status | `requireMapAccess(editor+)` |
| `/api/export/[layerId]` | GET | Export as GeoJSON/GeoPackage/Shapefile (`?format=`) | `getExportData` (viewer+) |
| `/api/export/[layerId]` | POST | Export as PDF (with screenshot in body) | `getExportData` (viewer+) |

### Geoprocessing tRPC Route

The geoprocessing subsystem uses tRPC:

**`geoprocessing.run`** mutation (`apps/web/src/lib/server/trpc/routers/geoprocessing.ts`):

```typescript
input: z.object({
  mapId: z.string().uuid(),
  op: GeoprocessingOpSchema,           // discriminated union, 10 op types
  outputLayerName: z.string().min(1).max(255).trim(),
})
// Returns: { layerId: string, layerName: string }
```

**10 operation types**: buffer, convex_hull, centroid, dissolve, intersect, union, clip, point_in_polygon, nearest_neighbor, aggregate.

Each operation is a single `INSERT...SELECT` raw SQL statement in `apps/web/src/lib/server/geo/geoprocessing.ts`. The router creates the output layer first, runs the PostGIS operation, and deletes the layer on failure (rollback pattern without transactions).

### Related tRPC Routes (Adjacent)

| Router | Relevant Procedures | Touches Data Pipeline? |
|---|---|---|
| `layers.list` | Lists layers with `featureCount` | Reads layers created by import |
| `layers.create` | Manual layer creation | Parallel path to import-created layers |
| `layers.delete` | Cascades to features | Cleans up import results |
| `features.list` | GeoJSON FeatureCollection query | Reads features inserted by import/geoprocessing |
| `features.create` | Single feature insert | Uses same `features` table |
| `features.bulkCreate` | Batch feature insert | Same table, uses ORM path |

---

## Contract Risks Summary

| # | Risk | Severity | Location |
|---|---|---|---|
| 1 | No upload file cleanup -- unbounded disk growth | HIGH | Upload route + Worker |
| 2 | Worker lacks `cleanupPreviousAttempt` -- duplicate layers on retry | HIGH | `services/worker/src/index.ts` |
| 3 | Worker bypasses Zod validation on parsed features | MEDIUM | Worker raw SQL inserts |
| 4 | Worker skips `invalidateLayer` -- stale GeoJSON cache | MEDIUM | Worker vs `geo/queries.ts` |
| 5 | Two independent Redis connection factories | LOW | `jobs/connection.ts` vs worker |
| 6 | No transaction wrapping in worker batch inserts | MEDIUM | Worker `processGeoJSON` etc. |
| 7 | Geoprocessing rollback uses DELETE not transaction | LOW | `geoprocessing.ts` router |

<!--
PROPOSED_SEEDS:
[
  {"title": "Add upload file cleanup after import job completion", "type": "task", "labels": ["data-pipeline", "disk-leak"], "priority": "high"},
  {"title": "Port cleanupPreviousAttempt to worker retry path", "type": "bug", "labels": ["data-pipeline", "worker"], "priority": "high"},
  {"title": "Add Zod validation in worker before PostGIS insert", "type": "task", "labels": ["data-pipeline", "validation"], "priority": "medium"},
  {"title": "Call invalidateLayer from worker after feature insert", "type": "bug", "labels": ["data-pipeline", "cache"], "priority": "medium"},
  {"title": "Unify Redis connection factory between web and worker", "type": "task", "labels": ["data-pipeline", "infra"], "priority": "low"},
  {"title": "Wrap worker batch inserts in PostgreSQL transaction", "type": "task", "labels": ["data-pipeline", "reliability"], "priority": "medium"}
]
-->
