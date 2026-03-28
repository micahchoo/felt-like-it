# Data Pipeline: Module Inventory & Analysis

> Per-file inventory, hotspot analysis, duplication audit, dead code scan, and era markers.

---

## 1. Module Inventory

### Import Subsystem (`apps/web/src/lib/server/import/`)

| File | LOC | Purpose | Key Dependencies |
|---|---|---|---|
| `index.ts` | 84 | Format dispatcher + retry cleanup | `geojson`, `csv`, `shapefile`, `xmlgeo`, `geopackage`, `geo/queries` |
| `shared.ts` | 70 | `createLayerAndInsertFeatures` -- shared tail for all importers | `geo-engine` (detectLayerType, generateAutoStyle), `geo/queries` (insertFeatures, getLayerBbox) |
| `geojson.ts` | 100 | GeoJSON parser + validator | `geo-engine` (validateGeoJSON), `shared.ts` |
| `csv.ts` | 149 | CSV parser with lat/lng detection + geocoding fallback | `geo-engine` (detectCoordinateColumns, geocodeBatch), `papaparse`, `shared.ts` |
| `shapefile.ts` | 87 | Shapefile (.shp/.zip) parser via shpjs | `shpjs`, `shared.ts` |
| `xmlgeo.ts` | 90 | KML/GPX parser via @tmcw/togeojson | `@xmldom/xmldom`, `@tmcw/togeojson`, `shared.ts` |
| `geopackage.ts` | 295 | GeoPackage parser via sql.js (WASM SQLite) | `sql.js`, `geo-engine`, `geo/queries` (insertWkbFeatures) |
| `sanitize.ts` | 16 | Filename sanitization (path traversal prevention) | None |
| **Total** | **891** | | |

### Export Subsystem (`apps/web/src/lib/server/export/`)

| File | LOC | Purpose | Key Dependencies |
|---|---|---|---|
| `shared.ts` | 68 | `getExportData` (auth + fetch), `toFeatureCollection` | Drizzle ORM (`layers`, `maps`, `mapCollaborators`), `geo/queries` |
| `shapefile.ts` | 50 | Shapefile export via @mapbox/shp-write | `@mapbox/shp-write`, `shared.ts` |
| `geopackage.ts` | 150 | GeoPackage export via sql.js + wkx | `sql.js`, `wkx`, `shared.ts` |
| `pdf.ts` | 70 | PDF export via pdfkit | `pdfkit`, `shared.ts` |
| **Total** | **338** | | |

### Job Infrastructure (`apps/web/src/lib/server/jobs/`)

| File | LOC | Purpose | Key Dependencies |
|---|---|---|---|
| `connection.ts` | 10 | Redis connection factory (SvelteKit env) | `ioredis`, `$env/dynamic/private` |
| `queues.ts` | 30 | BullMQ queue singleton + `enqueueImportJob` | `bullmq`, `connection.ts`, `@felt-like-it/shared-types` |
| **Total** | **40** | | |

### Geo Operations (`apps/web/src/lib/server/geo/`)

| File | LOC | Purpose | Key Dependencies |
|---|---|---|---|
| `queries.ts` | 181 | PostGIS query layer: `getLayerFeatures`, `insertFeatures`, `insertWkbFeatures`, `getLayerBbox`, `getImportJobLayerId`, `deleteLayer` | `drizzle-orm`, `api/geojson-cache` |
| `geoprocessing.ts` | 319 | 10 PostGIS geoprocessing ops (buffer, centroid, dissolve, intersect, union, clip, point_in_polygon, nearest_neighbor, aggregate, convex_hull) | `drizzle-orm`, `@felt-like-it/shared-types` |
| `access.ts` | 82 | Auth helpers: `requireMapOwnership`, `requireMapAccess` | Drizzle ORM |
| **Total** | **582** | | |

### Worker Service (`services/worker/src/`)

| File | LOC | Purpose | Key Dependencies |
|---|---|---|---|
| `index.ts` | 669 | Monolithic job processor: 6 format parsers + batch insert + status tracking | `bullmq`, `ioredis`, `drizzle-orm`, `pg`, `@felt-like-it/geo-engine`, `shpjs`, `papaparse`, `sql.js`, `@xmldom/xmldom`, `@tmcw/togeojson` |
| `logger.ts` | 9 | Pino logger config | `pino` |
| `shpjs.d.ts` | 16 | Type declarations for shpjs | None |
| **Total** | **694** | | |

### Shared Types (`packages/shared-types/src/schemas/`)

| File | LOC (est.) | Purpose | Consumers |
|---|---|---|---|
| `job.ts` | ~25 | `ImportJobPayloadSchema`, `ImportJobSchema`, `JobStatusSchema` | Web, Worker |
| `geoprocessing.ts` | ~120 | 10 op schemas + `GeoprocessingOpSchema` discriminated union + `GEO_OP_LABELS` | tRPC geoprocessing router |
| `feature.ts` | ~65 | `GeometrySchema`, `FeatureSchema`, `GeoJSONFeatureSchema` | All geometry consumers |
| `layer.ts` | ~30 | `LayerTypeSchema`, `CreateLayerSchema`, `UpdateLayerSchema` | Layer router, import |

### geo-engine Package (`packages/geo-engine/src/`)

| File | LOC | Purpose | Test File |
|---|---|---|---|
| `index.ts` | 10 | Barrel re-export | -- |
| `detect.ts` | 181 | Coordinate/address column detection, layer type detection | `detect.test.ts` |
| `validate.ts` | 128 | GeoJSON structural validation | `validate.test.ts` |
| `auto-style.ts` | 304 | Auto-generate layer styles from feature properties | `auto-style.test.ts` |
| `geocode.ts` | 112 | Batch geocoding via Nominatim | `geocode.test.ts` |
| `transform.ts` | 84 | Coordinate transforms | `transform.test.ts` |
| `measurement.ts` | 154 | Distance/area calculations | `measurement.test.ts` |
| `interpolators.ts` | 157 | Spatial interpolation | `interpolators.test.ts` |
| `filters.ts` | 100 | Feature filters | `filters.test.ts` |
| `classify.ts` | 56 | Data classification methods | `classify.test.ts` |
| `color-ramps.ts` | 49 | Color ramp definitions | -- |
| **Total** | **1335** | | 9 test files |

### SvelteKit API Routes

| File | LOC (est.) | Purpose |
|---|---|---|
| `routes/api/upload/+server.ts` | ~75 | `POST`: multipart upload -> disk -> import_jobs -> BullMQ |
| `routes/api/job/[jobId]/+server.ts` | ~35 | `GET`: poll job status from PostgreSQL |
| `routes/api/export/[layerId]/+server.ts` | ~80 | `GET`: export GeoJSON/GeoPackage/Shapefile; `POST`: export PDF |

### Grand Total

| Category | LOC |
|---|---|
| Import (web) | 891 |
| Export (web) | 338 |
| Jobs (web) | 40 |
| Geo ops (web) | 582 |
| Worker service | 694 |
| geo-engine package | 1,335 |
| API routes | ~190 |
| **Total data-pipeline** | **~4,070** |

---

## 2. Hotspot Analysis (Git Churn)

Top modified files (commits touching data-pipeline files):

| File | Modifications | Assessment |
|---|---|---|
| `packages/shared-types/src/__tests__/schemas.test.ts` | 5 | Schema evolution -- healthy churn |
| `packages/shared-types/src/index.ts` | 4 | Re-export additions -- correlates with schema growth |
| `services/worker/src/index.ts` | 3 | **Hotspot** -- 669-line monolith attracts changes |
| `apps/web/src/lib/server/export/shared.ts` | 3 | Auth model evolution |
| `apps/web/src/lib/server/import/xmlgeo.ts` | 2 | Library API updates |
| `apps/web/src/lib/server/import/shared.ts` | 2 | Shared tail refinements |
| `apps/web/src/lib/server/import/geojson.ts` | 2 | Validation improvements |
| `apps/web/src/lib/server/geo/queries.ts` | 2 | Query additions |
| `packages/geo-engine/src/auto-style.ts` | 2 | Styling logic growth |

**Key finding**: `services/worker/src/index.ts` is the #1 hotspot by absolute size. At 669 LOC with 3 modifications, it is the only file in the pipeline exceeding 300 LOC that is not a geo-engine module (which have stabilized with tests).

---

## 3. Code Duplication Audit

### Parser Duplication: Web vs Worker

The worker (`services/worker/src/index.ts`) contains **5 complete format parsers** that duplicate the web app's modular import system:

| Format | Web Module | Worker Function | Duplicated? |
|---|---|---|---|
| GeoJSON | `import/geojson.ts` (100 LOC) | `processGeoJSON()` (~80 LOC) | **YES** -- same parse + normalize + type guard logic |
| CSV | `import/csv.ts` (149 LOC) | `processCSV()` (~90 LOC) | **YES** -- same papaparse streaming, coordinate detection, geocoding |
| Shapefile | `import/shapefile.ts` (87 LOC) | `processShapefile()` (~60 LOC) | **YES** -- same shpjs ArrayBuffer handling |
| KML/GPX | `import/xmlgeo.ts` (90 LOC) | `processXmlGeo()` (~50 LOC) | **YES** -- same @tmcw/togeojson + @xmldom/xmldom |
| GeoPackage | `import/geopackage.ts` (295 LOC) | `processGeoPackage()` (~120 LOC) | **YES** -- same GeoPackage Binary Header parser, sql.js |

**Total duplicated logic**: ~400 LOC in the worker mirrors ~720 LOC in the web app. The worker versions are shorter because they skip some edge cases and validation that the web versions handle.

### GeoPackage Binary Header Parser

The GeoPackage Binary Header parser (`parseGpkgBlob`) is duplicated verbatim:
- Web: `apps/web/src/lib/server/import/geopackage.ts` -- exported, tested
- Worker: `services/worker/src/index.ts` -- inline, untested

The web version includes a comment: `// Converges to a shared import package in Phase 3.`

### Other Duplications

1. **`sanitizeFilename`** -- defined in `import/sanitize.ts` AND inline in `export/[layerId]/+server.ts` (different regex).
2. **GeoJSON type guards** (`isFeatureCollection`, `isFeature`, `isGeometry`) -- defined independently in both `import/geojson.ts` and `services/worker/src/index.ts`.
3. **Layer creation SQL** -- the web path uses `db.insert(layers).values(...)` while the worker uses raw `INSERT INTO layers (...)`.

---

## 4. Dead Code Analysis

### Unused Exports

| Export | File | Status |
|---|---|---|
| `importFile()` | `import/index.ts` | **Unused by web app** -- the upload route dispatches to BullMQ, not `importFile`. Only the worker's inline parsers are used. This entire dispatcher is dead code in the current async-only architecture. |
| `SupportedFormat` type | `import/index.ts` | Only used within `import/index.ts` itself |
| `detectFormat()` | `import/index.ts` | Only called by `importFile()` (which is itself unused) |
| `cleanupPreviousAttempt()` | `import/index.ts` | Only called by `importFile()` (dead) |
| `ImportResult` re-export from `geojson.ts` | `import/geojson.ts` | Redundant -- already exported from `shared.ts` and `index.ts` |

### Unreachable Code

- **Worker format check**: The worker's `processImportJob` switches on file extension. All 6 formats are covered plus a default `throw`. Since the upload route accepts any file, the throw is reachable but the web app's `detectFormat()` (which has its own validation) is never invoked in the async path.

### Orphaned Capability

- **`import/index.ts`** is an entire module (84 LOC) that exists for a **synchronous import path** that is no longer used. The web app always goes through BullMQ. The individual parser modules (`geojson.ts`, `csv.ts`, etc.) are imported by `import/index.ts` but also exist to be imported by a future refactored worker.

---

## 5. Era Markers

### Modern Patterns (Current Era)

| Pattern | Evidence |
|---|---|
| Zod schemas for all shared types | `packages/shared-types/src/schemas/` |
| Discriminated unions for geoprocessing ops | `GeoprocessingOpSchema` with exhaustive `assertNever` |
| Drizzle ORM with typed tables | `apps/web/src/lib/server/db/schema.ts` |
| SvelteKit `$env/dynamic/private` for config | `jobs/connection.ts` |
| Barrel re-exports | `geo-engine/src/index.ts`, `shared-types/src/index.ts` |
| Explicit eslint-disable with justification | All `no-await-in-loop` suppressions explain "sequential batches" |
| `workspace:*` protocol for monorepo deps | Both package.json files |

### Legacy Patterns (Pre-Refactor)

| Pattern | Evidence | Risk |
|---|---|---|
| **669-LOC monolith** | `services/worker/src/index.ts` -- all 5 parsers + DB ops + type guards in one file | High maintenance cost; every format change requires editing this file |
| `promisify(readFile)` | Worker uses `const readFileAsync = promisify(readFile)` alongside modern `import { readFile } from 'fs/promises'` within the same file | Mixed FS API eras in one file |
| `process.env['KEY']` bracket notation | Worker uses bracket notation for all env vars | Inconsistent with web app's `$env` |
| Raw SQL string building | Worker builds all SQL manually instead of using Drizzle table objects | Bypasses ORM's type safety |
| Inline type guards | Worker defines `isFeatureCollection`, `isFeature`, `isGeometry` locally | Should be in shared-types or geo-engine |
| Dynamic imports for format libraries | Both web and worker use `await import('papaparse')` etc. | Intentional (SSR/bundle optimization) but creates cold-start latency |

### Phase Markers (Planned Evolution)

Comments in the codebase indicate planned convergence:
- `geopackage.ts:1` (web): `// Converges to a shared import package in Phase 3`
- `geopackage.ts` (worker): `// GeoPackage Binary Header parser (mirrors geopackage.ts in the web app).`
- `import/index.ts`: Contains `cleanupPreviousAttempt` and `importFile` dispatcher -- infrastructure for a sync import path that may be re-enabled.

---

## Architecture Diagram

```
                        CLIENT
                          |
                   POST /api/upload
                          |
                    +-----v-----+
                    |  Upload   |   writes file to disk
                    |  Route    |   inserts import_jobs row
                    +-----+-----+   enqueues BullMQ job
                          |
                    Redis (BullMQ)
                    queue: file-import
                          |
                    +-----v-----+
                    |  Worker   |   reads file from disk
                    |  (669 LOC |   parses 6 formats inline
                    |  monolith)|   raw SQL inserts to PostGIS
                    +-----+-----+
                          |
                     PostgreSQL
                    (PostGIS 4326)
                          |
              +-----------+-----------+
              |                       |
        GET /api/job/[id]    GET /api/export/[layerId]
        (poll status)        (GeoJSON/GeoPackage/Shapefile/PDF)

                    --- UNUSED PATH ---
                    import/index.ts -> importFile()
                    (sync dispatch, dead code)
```

<!--
PROPOSED_SEEDS:
[
  {"title": "Extract shared parser package from web+worker duplication", "type": "task", "labels": ["data-pipeline", "duplication", "phase-3"], "priority": "high", "description": "~400 LOC duplicated across worker and web import modules. Extract to packages/import-parsers or merge into geo-engine."},
  {"title": "Split worker/src/index.ts monolith into per-format modules", "type": "task", "labels": ["data-pipeline", "worker", "maintainability"], "priority": "high", "description": "669 LOC single file with 5 parsers + DB ops + type guards. Split into worker/src/parsers/ + worker/src/db.ts."},
  {"title": "Remove dead code: import/index.ts importFile + detectFormat + cleanupPreviousAttempt", "type": "task", "labels": ["data-pipeline", "dead-code"], "priority": "medium", "description": "84 LOC module unused in async-only architecture. Either remove or re-enable for sync path."},
  {"title": "Unify sanitizeFilename implementations", "type": "task", "labels": ["data-pipeline", "duplication"], "priority": "low", "description": "Two different sanitizeFilename functions: import/sanitize.ts and inline in export route. Different regexes."},
  {"title": "Migrate worker from promisify(readFile) to fs/promises", "type": "task", "labels": ["data-pipeline", "modernize"], "priority": "low", "description": "Worker mixes legacy promisify pattern with modern fs/promises in same file."},
  {"title": "Move GeoJSON type guards to shared-types or geo-engine", "type": "task", "labels": ["data-pipeline", "duplication"], "priority": "low", "description": "isFeatureCollection, isFeature, isGeometry defined independently in web and worker."}
]
-->
