# Data Pipeline: Inter-Subsystem Contracts

> Characterizes every interface between the data-pipeline and adjacent subsystems.
> Each section traces the exact contract shape, identifies gaps, and notes risks.
>
> Cross-references: [components](components.md) | [behavior](behavior.md)

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

**Worker-side consumer** (`services/worker/src/index.ts`):
- Creates a `Worker<ImportJobPayload>('file-import', processImportJob, { concurrency: 3 })`.
- Uses its own ioredis connection, not the web app's.

### ImportJobPayload Schema

Defined in `packages/shared-types/src/schemas/job.ts`:

```typescript
ImportJobPayloadSchema = z.object({
  jobId:     z.string().uuid(),
  mapId:     z.string().uuid(),
  layerName: z.string(),
  filePath:  z.string(),   // absolute path on shared filesystem
  fileName:  z.string(),   // original user-supplied filename
});
```

**Contract status**: TYPED (Zod schema in shared-types, imported by both web and worker).

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

## 2. Import-Engine Package Boundary (NEW)

### Package Identity

- **Package**: `@felt-like-it/import-engine` (`packages/import-engine/`)
- **Dependencies**: `papaparse`, `shpjs`, `fast-xml-parser`, `sql.js`, `@felt-like-it/shared-types workspace:*`, `@felt-like-it/geo-engine workspace:*`
- **Consumers**: `apps/web/src/lib/server/import/*` (web), `services/worker/src/index.ts` (worker)

### Type Contracts

Defined in `packages/import-engine/src/types.ts`:

```typescript
/** Standard parsed feature -- GeoJSON geometry + properties. */
interface ParsedFeature {
  geometry: Geometry;                    // from @felt-like-it/shared-types
  properties: Record<string, unknown>;
}

/** GeoPackage parsed feature -- WKB binary + SRID. */
interface ParsedWkbFeature {
  wkbHex: string;
  srid: number;
  properties: Record<string, unknown>;
}

/** Parsed CSV with headers preserved for coordinate detection. */
interface ParsedCsv {
  headers: string[];
  rows: Record<string, string>[];
}
```

**Contract status**: TYPED. `ParsedFeature` uses `Geometry` from shared-types (Zod-validated discriminated union of Point/LineString/Polygon/Multi*). `ParsedWkbFeature` is structurally typed but not Zod-validated (wkbHex is `string`, not validated as hex).

### Exported API Surface

| Module | Function | Return Type | Consumers |
|---|---|---|---|
| `geojson.ts` | `parseGeoJSON(filePath)` | `Promise<ParsedFeature[]>` | Web (geojson.ts), Worker |
| `csv.ts` | `parseCSV(filePath)` | `Promise<ParsedCsv>` | Web (csv.ts), Worker |
| `csv.ts` | `csvRowsToFeatures(headers, rows)` | `ParsedFeature[]` | Web (csv.ts), Worker |
| `shapefile.ts` | `parseShapefile(filePath)` | `Promise<ParsedFeature[]>` | Web (shapefile.ts), Worker |
| `kml.ts` | `parseKML(filePath)` | `Promise<ParsedFeature[]>` | Web (xmlgeo.ts), Worker |
| `gpx.ts` | `parseGPX(filePath)` | `Promise<ParsedFeature[]>` | Web (xmlgeo.ts), Worker |
| `geopackage.ts` | `parseGeoPackage(filePath)` | `Promise<{ features: ParsedWkbFeature[], layerType, tableName }>` | Web (geopackage.ts), Worker |
| `geopackage.ts` | `parseGpkgBlob(blob)` | `ParsedBlob \| null` | Web (re-exported), internal |
| `geopackage.ts` | `gpkgGeomTypeToLayerType(name)` | `LayerType` | Web (re-exported), internal |
| `sanitize.ts` | `sanitizeFilename(name)` | `string` | Web (sanitize.ts re-export) |

### Dependency Graph

```
shared-types ──> import-engine ──> geo-engine
                      │
         ┌────────────┴────────────┐
         v                         v
  server/import/*            services/worker
  (thin wrappers)            (full orchestration)
```

**Key observation**: import-engine depends on geo-engine for coordinate detection (`detectCoordinateColumns`, `isValidLatitude`, `isValidLongitude`) within `csvRowsToFeatures`. This means import-engine is not a pure parser -- it encodes detection logic via geo-engine.

---

## 3. Thin Wrapper Pattern (server/import/* <-> import-engine)

### Architecture

The web-side import modules (`apps/web/src/lib/server/import/`) follow a consistent **thin wrapper** pattern:

1. **Parse**: Call import-engine's parser (e.g., `parseGeoJSON(filePath)`)
2. **Orchestrate**: Call `createLayerAndInsertFeatures()` from `shared.ts`

The orchestration layer (`shared.ts`) handles: layer type detection, auto-styling, DB layer creation, batch feature insertion (500/batch), progress updates, bbox calculation.

### Module Contract Map

| Web Module | Import-Engine Function | Orchestration |
|---|---|---|
| `geojson.ts` | `parseGeoJSON` | `createLayerAndInsertFeatures` |
| `shapefile.ts` | `parseShapefile` | `createLayerAndInsertFeatures` |
| `xmlgeo.ts` | `parseKML` / `parseGPX` | `createLayerAndInsertFeatures` |
| `csv.ts` | `parseCSV` + `csvRowsToFeatures` | `createLayerAndInsertFeatures` (with geocoding side-path) |
| `geopackage.ts` | `parseGeoPackage` | Custom (WKB path via `insertWkbFeatures`) |
| `sanitize.ts` | `sanitizeFilename` | Pure re-export |

**Contract status**: CLEAN for 4/6 formats. GeoPackage has a custom orchestration path because `ParsedWkbFeature` requires `ST_GeomFromWKB` instead of `ST_GeomFromGeoJSON`. CSV has a geocoding side-path that stays in the web module (needs API keys + progress callbacks).

### `createLayerAndInsertFeatures` Signature

```typescript
function createLayerAndInsertFeatures(opts: {
  mapId: string;
  jobId: string;
  layerName: string;
  features: Array<{ geometry: Geometry; properties: Record<string, unknown> }>;
  layerTypeOverride?: 'point' | 'line' | 'polygon' | 'mixed';
}): Promise<ImportResult>

interface ImportResult {
  layerId: string;
  featureCount: number;
  bbox: [number, number, number, number] | null;
}
```

**Contract status**: TYPED. Uses Drizzle ORM for DB operations, `insertFeatures` from `geo/queries.ts` for PostGIS insert.

---

## 4. Worker <-> Database Boundary

### Dual Database Access Pattern

The worker uses **drizzle-orm's `sql` tagged template** for raw SQL but does NOT use the schema definitions or table objects from the web app. It creates its own `pg.Pool` and `drizzle(pool)` instance.

**Web app path** (`apps/web/src/lib/server/import/shared.ts`):
- Uses Drizzle ORM table objects (`db.insert(layers)`, `db.update(importJobs)`)
- Uses `insertFeatures()` / `insertWkbFeatures()` from `geo/queries.ts`
- Validates via Zod schemas before insert
- Calls `getLayerBbox()` after inserts

**Worker path** (`services/worker/src/index.ts`):
- All SQL is raw via `db.execute(sql\`...\`)` and `pool.query()`
- No Zod validation of parsed features before insert
- No `getLayerBbox()` call
- Has its own `cleanupPreviousAttempt` logic (queries `import_jobs` for stale `layer_id`, deletes features + layers)
- Has its own `insertFeaturesBatch()` helper

### SQL Patterns in the Worker

1. **Cleanup on retry**: `SELECT layer_id FROM import_jobs WHERE id = $1 AND layer_id IS NOT NULL` -> cascade DELETE features, layers, NULL layer_id
2. **Layer creation**: `INSERT INTO layers (map_id, name, type, style, source_file_name) VALUES (...) RETURNING id`
3. **Job status update**: `UPDATE import_jobs SET status = $1, progress = $2, updated_at = NOW() WHERE id = $3`
4. **Feature insert (GeoJSON path)**: Multi-row `INSERT INTO features (layer_id, geometry, properties) VALUES (uuid, ST_GeomFromGeoJSON(...), jsonb)` batched at 500
5. **Feature insert (WKB path, GeoPackage)**: `INSERT INTO features (layer_id, geometry, properties) VALUES (uuid, ST_GeomFromWKB(decode(hex, 'hex'), srid), jsonb)` with optional `ST_Transform` for non-4326 SRIDs

### Validation Gap

| Check | Web (ORM path) | Worker (raw SQL) |
|---|---|---|
| Geometry Zod schema | Yes (via shared-types) | No -- relies on PostGIS `ST_GeomFromGeoJSON` to reject invalid |
| Properties JSONB | Typed via Drizzle schema | `JSON.stringify()` directly -- no size or depth limit |
| Layer type enum | Drizzle enum constraint | String literal passed to SQL |
| Feature count limit | None | None |
| File size limit | 100MB (upload route) | No re-check |

**Improvement since last scan**: Worker now has `cleanupPreviousAttempt` logic (queries for stale layer_id and cascades delete). This addresses the previously-flagged duplicate layers on retry risk.

---

## 5. Filesystem Contract

### Path Convention

```
UPLOAD_DIR / {jobId} / {sanitized-filename}
```

- `UPLOAD_DIR` defaults to `/tmp/felt-uploads` (configurable via `UPLOAD_DIR` env var).
- Each job gets its own subdirectory named by UUID.
- Filename sanitized via `sanitizeFilename` (now in `import-engine/src/sanitize.ts`): strips directory components (including Windows `\`), replaces unsafe chars, collapses pure-dot names to underscores.
- Defense-in-depth: resolved path checked with `startsWith(jobDir)` at upload route.

**Contract status**: IMPLICIT. The `UPLOAD_DIR` + `{jobId}/{filename}` convention is not encoded in a shared type -- `filePath` in `ImportJobPayload` is just `z.string()`. Both sides must agree on filesystem layout by convention.

### Lifecycle

| Phase | Actor | Action |
|---|---|---|
| Write | Web upload route | `mkdir(jobDir, { recursive: true })` + `writeFile(filePath, buffer)` |
| Read | Worker process | `readFile(filePath)` or `createReadStream(filePath)` |
| Read | Web import (direct) | `readFile(filePath)` via import-engine parsers |
| Delete | **Nobody** | No cleanup exists |

**Critical gap**: Upload files are **never deleted**. No cleanup on job completion, failure, or expiry. The `/tmp/felt-uploads` directory will grow unboundedly in production.

### Crash Recovery

- BullMQ retries (3 attempts) will re-read the same file from disk since the jobId subdirectory persists.
- The web import path (`apps/web/src/lib/server/import/shared.ts`) uses `createLayerAndInsertFeatures` which is not idempotent -- retry would create a second layer.
- The worker NOW has cleanup: queries `import_jobs.layer_id`, deletes stale features/layers before re-processing.

---

## 6. geo-engine Package Boundary

### Package Identity

- **Package**: `@felt-like-it/geo-engine` (`packages/geo-engine/`)
- **Dependency**: `@turf/turf ^7.1.0`, `@felt-like-it/shared-types workspace:*`

### Consumer Map (Data Pipeline Only)

| Function | Web import (shared.ts) | Web import (csv.ts) | Worker | Import-Engine |
|---|---|---|---|---|
| `detectLayerType` | Yes | - | Yes | - |
| `generateAutoStyle` | Yes | - | Yes | - |
| `detectCoordinateColumns` | - | Yes | Yes | Yes (csv.ts) |
| `isValidLatitude/Longitude` | - | - | - | Yes (csv.ts) |
| `detectAddressColumn` | - | Yes | Yes | - |
| `geocodeBatch` | - | Yes | Yes | - |
| `validateGeoJSON` | - | - | - | Yes (geojson.ts) |

**Key change**: Import-engine now consumes geo-engine directly for coordinate detection and GeoJSON validation. This creates a diamond dependency:

```
           shared-types
          /            \
   geo-engine     import-engine
          \       /    |
    server/import/*    |
              \        |
               worker -┘
```

**Risk**: Version drift between import-engine's geo-engine dependency and direct consumer imports. Currently mitigated by `workspace:*` linking, but would break with independent versioning.

---

## 7. tRPC Contract

### Import/Export tRPC Routes

Import and export do **not** use tRPC. They use plain SvelteKit API routes:

| Endpoint | Method | Purpose | Auth |
|---|---|---|---|
| `/api/upload` | POST | Multipart file upload, creates import job | `requireMapAccess(editor+)` |
| `/api/job/[jobId]` | GET | Poll import job status | `requireMapAccess(editor+)` |
| `/api/export/[layerId]` | GET | Export as GeoJSON/GeoPackage/Shapefile (`?format=`) | `getExportData` (viewer+) |
| `/api/export/[layerId]` | POST | Export as PDF (with screenshot in body) | `getExportData` (viewer+) |

### Geoprocessing tRPC Route

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

## 8. Knot Analysis

### Dependency Crossings at Boundaries

| Boundary | Crossings | Direction | Typed? |
|---|---|---|---|
| Web -> BullMQ -> Worker | 1 (ImportJobPayload) | Web produces, Worker consumes | Yes (Zod) |
| Web -> import-engine | 7 functions + 3 types | Web calls, import-engine returns | Yes (TS interfaces) |
| Worker -> import-engine | 7 functions + 1 type | Worker calls, import-engine returns | Yes (TS interfaces) |
| import-engine -> geo-engine | 4 functions | import-engine calls | Yes (TS) |
| import-engine -> shared-types | 1 type (`Geometry`) | import-engine imports | Yes (Zod schema) |
| Web -> geo-engine (direct) | 3 functions | Web import modules call | Yes (TS) |
| Worker -> geo-engine (direct) | 5 functions | Worker calls | Yes (TS) |
| Web/Worker -> PostgreSQL | Raw SQL (worker) / ORM (web) | Both write | SPLIT -- web typed, worker untyped |
| Web/Worker -> Filesystem | `filePath: string` | Convention-based | IMPLICIT |
| Worker -> Redis | ioredis connection | Worker consumes | Convention (env var) |
| Web -> Redis | ioredis connection | Web produces | Convention (env var) |

**Total crossings**: 11 boundary interfaces. **8 typed**, **2 convention-based** (filesystem, Redis), **1 split** (DB access divergence).

### Separability Assessment

The thin wrapper pattern is **clean** for the standard path (ParsedFeature-based formats):

```
import-engine.parse*(filePath)  -->  ParsedFeature[]  -->  shared.createLayerAndInsertFeatures()
```

Two **exceptions** reduce separability:
1. **GeoPackage**: Returns `ParsedWkbFeature[]` requiring a different DB insertion path (`insertWkbFeatures` vs `insertFeatures`). The web geopackage.ts has its own orchestration rather than using shared.ts.
2. **CSV geocoding**: The geocoding side-path (address -> Nominatim -> coordinates) stays in web `csv.ts` and worker `processCSV` because it requires API keys and progress callbacks. Import-engine only provides `parseCSV` + `csvRowsToFeatures`.

**Separability score**: 4/6 formats are fully separable through the thin wrapper. 2/6 have justified coupling.

### Security Pins

| Pin | Type | Risk | Location |
|---|---|---|---|
| `filePath` in ImportJobPayload | Filesystem path injection | Worker reads arbitrary path from Redis queue. No re-validation of path against `UPLOAD_DIR` at worker side. | `services/worker/src/index.ts` |
| `sanitizeFilename` | Path traversal defense | Strips `..`, directory components, unsafe chars. Now in import-engine, re-exported by web. | `packages/import-engine/src/sanitize.ts` |
| `startsWith(jobDir)` check | Defense-in-depth | Only at upload route (web side). Worker trusts `filePath` from queue. | Upload route only |
| `REDIS_URL` env var | Queue poisoning surface | If Redis is compromised, attacker controls `filePath` -> arbitrary file read by worker. | Both connection factories |
| `DATABASE_URL` env var | DB credential surface | Worker has direct pool access with `max: 5` connections. No connection-level auth beyond connection string. | `services/worker/src/index.ts` |
| JSON.stringify on properties | JSONB injection | Worker passes `JSON.stringify(f.properties)::jsonb` to raw SQL. No size/depth limit on properties object. | Worker `insertFeaturesBatch` |
| `wkbHex` passthrough | Binary injection | Worker passes `decode(${r.wkbHex}, 'hex')` to PostGIS. Only validated by `parseGpkgBlob` header check (magic bytes + offset), not full WKB validation. | Worker `processGeoPackage` |

---

## Contract Health Summary

| Contract | Status | Evidence |
|---|---|---|
| ImportJobPayload (Web <-> Worker) | TYPED | Zod schema in shared-types, imported by both |
| ParsedFeature (import-engine <-> consumers) | TYPED | TS interface backed by shared-types Geometry |
| ParsedWkbFeature (import-engine <-> consumers) | PARTIALLY TYPED | TS interface but wkbHex is unvalidated string |
| ParsedCsv (import-engine <-> consumers) | TYPED | TS interface |
| ImportResult (server/import internal) | TYPED | TS interface in shared.ts |
| createLayerAndInsertFeatures (orchestration) | TYPED | Full TS signature with optional override |
| DB schema (web ORM path) | TYPED | Drizzle schema + Zod validation |
| DB access (worker raw SQL path) | IMPLICIT | Raw SQL strings, no schema validation |
| Filesystem layout | IMPLICIT | Convention: `UPLOAD_DIR/{jobId}/{filename}` |
| Redis connection | IMPLICIT | Env var convention, duplicated factories |
| sanitizeFilename | TYPED | Deterministic pure function, import-engine owned |

---

## Contract Risks Summary

| # | Risk | Severity | Location | Status |
|---|---|---|---|---|
| 1 | No upload file cleanup -- unbounded disk growth | HIGH | Upload route + Worker | OPEN |
| 2 | Worker bypasses Zod validation on parsed features | MEDIUM | Worker raw SQL inserts | OPEN |
| 3 | Worker skips `getLayerBbox` -- no bbox in ImportResult | LOW | Worker vs shared.ts | OPEN |
| 4 | Two independent Redis connection factories | LOW | `jobs/connection.ts` vs worker | OPEN |
| 5 | Filesystem path implicit contract (no re-validation at worker) | MEDIUM | Worker reads filePath from queue | OPEN |
| 6 | wkbHex passed to PostGIS without full WKB validation | LOW | Worker + web geopackage.ts | OPEN |
| 7 | JSON properties size/depth unlimited at worker | MEDIUM | Worker insertFeaturesBatch | OPEN |
| 8 | Diamond dependency (geo-engine) version drift risk | LOW | import-engine + direct consumers | MITIGATED (workspace:*) |
| ~~9~~ | ~~Worker lacks cleanupPreviousAttempt -- duplicate layers~~ | ~~HIGH~~ | ~~Worker~~ | **RESOLVED** |
| ~~10~~ | ~~Worker skips invalidateLayer -- stale GeoJSON cache~~ | ~~MEDIUM~~ | ~~Worker~~ | **DEFERRED** (cache architecture TBD) |
| ~~11~~ | ~~Geoprocessing rollback uses DELETE not transaction~~ | ~~LOW~~ | ~~geoprocessing.ts~~ | **UNCHANGED** |

<!--
PROPOSED_SEEDS:
[
  {"title": "Add upload file cleanup after import job completion", "type": "task", "labels": ["data-pipeline", "disk-leak"], "priority": "high"},
  {"title": "Add Zod validation in worker before PostGIS insert", "type": "task", "labels": ["data-pipeline", "validation"], "priority": "medium"},
  {"title": "Validate filePath against UPLOAD_DIR at worker entry", "type": "task", "labels": ["data-pipeline", "security"], "priority": "medium"},
  {"title": "Add JSONB properties size limit at worker", "type": "task", "labels": ["data-pipeline", "security"], "priority": "medium"},
  {"title": "Unify Redis connection factory between web and worker", "type": "task", "labels": ["data-pipeline", "infra"], "priority": "low"}
]
-->
</content>
</invoke>