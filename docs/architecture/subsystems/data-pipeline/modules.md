# Data Pipeline: Module Inventory & Analysis

> Per-file inventory, hotspot analysis, duplication audit, dead code scan, and era markers.
> **Re-scanned 2026-03-29** after import-engine extraction.

---

## 1. Module Inventory

### import-engine Package (`packages/import-engine/src/`)

The canonical source-of-truth for all format parsing. Extracted from the web app's server-side parsers and the worker's inline parsers. Pure functions -- no DB, no HTTP, no framework dependencies.

| File | LOC | Exported Functions | Key Dependencies |
|---|---|---|---|
| `index.ts` | 8 | Barrel re-export | All modules below |
| `types.ts` | 23 | `ParsedFeature`, `ParsedWkbFeature`, `ParsedCsv` | `@felt-like-it/shared-types` (Geometry) |
| `geojson.ts` | 89 | `parseGeoJSON(filePath): Promise<ParsedFeature[]>` | `geo-engine` (validateGeoJSON) |
| `csv.ts` | 86 | `parseCSV(filePath): Promise<ParsedCsv>`, `csvRowsToFeatures(headers, rows): ParsedFeature[]` | `papaparse`, `geo-engine` (detectCoordinateColumns, isValidLatitude, isValidLongitude) |
| `shapefile.ts` | 69 | `parseShapefile(filePath): Promise<ParsedFeature[]>` | `shpjs` |
| `kml.ts` | 222 | `parseKML(filePath): Promise<ParsedFeature[]>` | `fast-xml-parser` |
| `gpx.ts` | 147 | `parseGPX(filePath): Promise<ParsedFeature[]>` | `fast-xml-parser` |
| `geopackage.ts` | 265 | `parseGeoPackage(filePath): Promise<{features, layerType}>`, `parseGpkgBlob(blob): ParsedBlob\|null`, `gpkgGeomTypeToLayerType(name): string` | `sql.js` |
| `sanitize.ts` | 16 | `sanitizeFilename(name): string` | `path` (Node built-in) |
| `vendor.d.ts` | 45 | Type declarations for shpjs | -- |
| **Total** | **970** | | |

**Test coverage**: 7 test files (842 LOC total):
| Test File | LOC | Covers |
|---|---|---|
| `geojson.test.ts` | 134 | `parseGeoJSON` |
| `csv.test.ts` | 104 | `parseCSV`, `csvRowsToFeatures` |
| `shapefile.test.ts` | 72 | `parseShapefile` |
| `kml.test.ts` | 198 | `parseKML` |
| `gpx.test.ts` | 166 | `parseGPX` |
| `geopackage.test.ts` | 135 | `parseGeoPackage`, `parseGpkgBlob`, `gpkgGeomTypeToLayerType` |
| `sanitize.test.ts` | 33 | `sanitizeFilename` |

**Design note**: KML/GPX parsing uses `fast-xml-parser` (zero-dep, fast) instead of the old `@tmcw/togeojson` + `@xmldom/xmldom` stack. This is a deliberate library swap -- the old libraries remain in web and worker `package.json` as **orphaned dependencies** (see Deadwood section).

### Import Wrappers (`apps/web/src/lib/server/import/`)

Thin wrappers that delegate parsing to `import-engine` and handle DB operations (layer creation, batch insert, progress tracking). The "shared tail" pattern: parse -> `createLayerAndInsertFeatures`.

| File | LOC | Purpose | Delegates To |
|---|---|---|---|
| `shared.ts` | 70 | `createLayerAndInsertFeatures` -- batch insert, auto-style, progress | `geo-engine`, `geo/queries` |
| `geojson.ts` | 25 | `importGeoJSON` wrapper | `import-engine.parseGeoJSON` -> `shared.ts` |
| `csv.ts` | 101 | `importCSV` wrapper (coord detect + geocoding fallback) | `import-engine.parseCSV`, `import-engine.csvRowsToFeatures`, `geo-engine.geocodeBatch` |
| `shapefile.ts` | 23 | `importShapefile` wrapper | `import-engine.parseShapefile` -> `shared.ts` |
| `xmlgeo.ts` | 37 | `importXmlGeo` wrapper (KML/GPX) | `import-engine.parseKML`, `import-engine.parseGPX` -> `shared.ts` |
| `geopackage.ts` | 79 | `importGeoPackage` wrapper (WKB insert path) | `import-engine.parseGeoPackage` -> `geo/queries.insertWkbFeatures` |
| `sanitize.ts` | 1 | **Re-export shim** | `import-engine.sanitizeFilename` |
| **Total** | **336** | | |

**Deleted**: `index.ts` (was 84 LOC format dispatcher + `importFile` + `detectFormat` + `cleanupPreviousAttempt`) -- removed as dead code in the extraction.

**Wrapper thickness analysis**:
- **Thin** (parse -> shared tail): `geojson.ts` (25 LOC), `shapefile.ts` (23 LOC), `xmlgeo.ts` (37 LOC)
- **Medium** (parse + format-specific DB path): `geopackage.ts` (79 LOC) -- WKB hex->bytes conversion + direct `insertWkbFeatures`
- **Thick** (parse + application logic): `csv.ts` (101 LOC) -- coordinate detection, geocoding fallback with progress callbacks, Nominatim integration

### Export Subsystem (`apps/web/src/lib/server/export/`)

Unchanged from prior scan.

| File | LOC | Purpose | Key Dependencies |
|---|---|---|---|
| `shared.ts` | 68 | `getExportData` (auth + fetch), `toFeatureCollection` | Drizzle ORM, `geo/queries` |
| `shapefile.ts` | 50 | Shapefile export via @mapbox/shp-write | `@mapbox/shp-write`, `shared.ts` |
| `geopackage.ts` | 150 | GeoPackage export via sql.js + wkx | `sql.js`, `wkx`, `shared.ts` |
| `pdf.ts` | 70 | PDF export via pdfkit | `pdfkit`, `shared.ts` |
| **Total** | **338** | | |

### Worker Service (`services/worker/src/`)

Now imports parsers from `@felt-like-it/import-engine` but retains its own DB insertion logic (raw SQL). Reduced from 669 LOC to 431 LOC.

| File | LOC | Purpose | Key Dependencies |
|---|---|---|---|
| `index.ts` | 431 | Job processor: delegates parsing to import-engine, raw SQL insert + status tracking | `bullmq`, `ioredis`, `drizzle-orm`, `pg`, `@felt-like-it/import-engine`, `@felt-like-it/geo-engine` |
| `logger.ts` | 9 | Pino logger config | `pino` |
| **Total** | **440** | | |

**Function map** (worker/src/index.ts):

| Function | Lines | Purpose |
|---|---|---|
| `processImportJob` | 54-108 | Job entry: cleanup stale state, format dispatch by extension |
| `processGeoJSON` | 110-143 | Parse via import-engine -> `insertFeaturesBatch` |
| `processCSV` | 145-265 | Parse via import-engine, coord detect / geocoding fallback -> `insertFeaturesBatch` |
| `processShapefile` | 267-298 | Parse via import-engine -> `insertFeaturesBatch` |
| `processXmlGeo` | 300-340 | Parse via import-engine (KML/GPX) -> `insertFeaturesBatch` |
| `processGeoPackage` | 342-395 | Parse via import-engine -> WKB batch insert (inline) |
| `insertFeaturesBatch` | ~20 LOC | Generic GeoJSON batch insert helper |
| `updateJobStatus` | ~8 LOC | SQL update helper |

**Remaining legacy**: Raw SQL for layer creation and feature insertion (bypasses Drizzle table objects). Each `process*` function creates layers and does batch inserts independently -- the web wrappers' shared-tail pattern was not adopted.

### Geo Operations (`apps/web/src/lib/server/geo/`)

Unchanged from prior scan (585 LOC total).

| File | LOC | Purpose |
|---|---|---|
| `queries.ts` | 181 | PostGIS query layer |
| `geoprocessing.ts` | 322 | 10 PostGIS geoprocessing ops |
| `access.ts` | 82 | Auth helpers |

### Job Infrastructure (`apps/web/src/lib/server/jobs/`)

Unchanged from prior scan (40 LOC total).

### geo-engine Package (`packages/geo-engine/src/`)

Unchanged from prior scan (1,335 LOC total, 9 test files).

### Shared Types (`packages/shared-types/src/schemas/`)

Unchanged from prior scan.

### Grand Total

| Category | LOC (prior) | LOC (current) | Delta |
|---|---|---|---|
| **import-engine package** | -- | **970** | **+970** (new) |
| Import wrappers (web) | 891 | **336** | **-555** |
| Export (web) | 338 | 338 | 0 |
| Jobs (web) | 40 | 40 | 0 |
| Geo ops (web) | 582 | 585 | +3 |
| Worker service | 694 | **440** | **-254** |
| geo-engine package | 1,335 | 1,335 | 0 |
| API routes | ~190 | ~190 | 0 |
| **Total data-pipeline** | **~4,070** | **~4,234** | **+164** |

Net LOC increased by ~164, but this is misleading: 970 LOC of tested, pure-function parsing logic was extracted. The web wrappers shed 555 LOC (62% reduction) and the worker shed 254 LOC (37% reduction). The net growth is the import-engine's types, tests infrastructure, and vendor declarations.

---

## 2. Hotspot Analysis

Top change-attracting files (post-extraction):

| File | Risk | Assessment |
|---|---|---|
| `services/worker/src/index.ts` | **Medium** | Reduced from 669 to 431 LOC. Still monolithic (6 `process*` functions + DB ops in one file) but parsing logic is now delegated. |
| `apps/web/src/lib/server/import/csv.ts` | **Low** | Thickest wrapper (101 LOC) -- geocoding fallback logic stays here. |
| `apps/web/src/lib/server/import/geopackage.ts` | **Low** | WKB-specific insert path (79 LOC) -- format-specific DB logic that can't use shared tail. |
| `packages/import-engine/src/kml.ts` | **Low** | Largest parser (222 LOC) but stable -- new library (`fast-xml-parser`), well-tested (198 LOC test). |

---

## 3. Deadwood Inventory

### DEADWOOD-1: Orphaned Parser Dependencies in Web + Worker

Both `apps/web/package.json` and `services/worker/package.json` still list parser libraries that are now consumed exclusively by `import-engine`:

| Dependency | import-engine | web | worker | Status |
|---|---|---|---|---|
| `papaparse` | `^5.4.1` | `^5.4.1` | `^5.4.1` | **Orphaned** in web+worker (only import-engine imports it) |
| `shpjs` | `^6.1.0` | `^6.2.0` | `^6.2.0` | **Orphaned** in web+worker |
| `sql.js` | `^1.12.0` | `^1.14.0` | `^1.14.0` | **Partially orphaned**: web export/geopackage.ts still uses it directly. Worker: orphaned. |
| `@tmcw/togeojson` | -- | `^7.1.2` | `^7.1.2` | **Fully orphaned**: zero imports in web src or worker src (replaced by fast-xml-parser in import-engine) |
| `@xmldom/xmldom` | -- | `^0.8.11` | `^0.8.11` | **Fully orphaned**: zero imports in web src or worker src |
| `@types/papaparse` | `^5.3.15` | `^5.3.14` | `^5.3.14` | **Orphaned** in web+worker |
| `@types/shpjs` | -- | `^3.4.7` | -- | **Orphaned** in web |
| `@types/sql.js` | -- | `^1.4.9` | `^1.4.9` | Worker: orphaned. Web: needed for export. |

**Risk**: Low (pnpm workspace hoisting means they resolve, but they inflate install and confuse dependency audits).
**Action**: Remove orphaned deps from web and worker `package.json`. Keep `sql.js` + `@types/sql.js` in web (export uses it).

### DEADWOOD-2: sanitize.ts Re-export Shim

`apps/web/src/lib/server/import/sanitize.ts` is a 1-line re-export:
```ts
export { sanitizeFilename } from '@felt-like-it/import-engine';
```

**Risk**: Negligible. Prevents breaking existing import paths.
**Action**: Keep for now. When next touching consumers, update import paths to `@felt-like-it/import-engine` directly, then delete.

### DEADWOOD-3: Worker DB Insertion Duplication

The worker's `process*` functions each contain raw SQL for:
1. Layer creation (`INSERT INTO layers ...`)
2. Feature batch insertion (`INSERT INTO features ...` with `ST_GeomFromGeoJSON` or `ST_GeomFromWKB`)
3. Job status updates (`UPDATE import_jobs ...`)

The web wrappers use `shared.ts` + `geo/queries.ts` (Drizzle-backed) for the same operations. This is **structural duplication** -- same schema operations, different SQL dialects (raw vs ORM).

**Risk**: Medium. Schema changes require updating both paths. The worker's raw SQL bypasses Drizzle's type safety.
**Action**: Extract a shared DB insertion module importable by both web and worker, or have the worker call the same `geo/queries` functions.

### DEADWOOD-4: Version Drift in import-engine Dependencies

| Dependency | import-engine | web/worker | Gap |
|---|---|---|---|
| `shpjs` | `^6.1.0` | `^6.2.0` | Minor version lag |
| `sql.js` | `^1.12.0` | `^1.14.0` | Minor version lag |

**Risk**: Low (semver-compatible ranges). pnpm likely resolves to the same version via hoisting.
**Action**: Bump import-engine to match (`^6.2.0`, `^1.14.0`).

---

## 4. Era Markers (Updated)

### Modern Patterns (Current Era)

| Pattern | Evidence |
|---|---|
| Pure-function parser package | `packages/import-engine/` -- no DB, no HTTP, no framework deps |
| Thin wrapper delegation | Web import modules delegate to import-engine, add only DB ops |
| fast-xml-parser for KML/GPX | Replaces @tmcw/togeojson + @xmldom/xmldom (2-dep -> 1-dep) |
| Comprehensive parser tests | 842 LOC of tests in import-engine, 7 test files |
| Zod schemas for shared types | `packages/shared-types/src/schemas/` |
| Drizzle ORM with typed tables | Web import wrappers + geo/queries |
| `workspace:*` protocol | All internal package references |

### Legacy Patterns (Residual)

| Pattern | Evidence | Risk |
|---|---|---|
| **431-LOC worker monolith** | `services/worker/src/index.ts` -- 6 process functions + DB ops | Medium -- reduced from 669 but still a single file |
| Raw SQL in worker | Worker builds all SQL manually instead of using Drizzle table objects | Medium -- schema changes require dual updates |
| `process.env['KEY']` bracket notation | Worker uses bracket notation for all env vars | Low -- inconsistent with web's `$env` |
| Orphaned dependencies | @tmcw/togeojson, @xmldom/xmldom, papaparse, shpjs in web+worker | Low -- inflate install |
| Dynamic imports for format libraries | import-engine uses `await import('papaparse')` | Intentional (bundle optimization) |

### Phase Markers

- `geopackage.ts` web wrapper: re-exports `parseGpkgBlob`, `gpkgGeomTypeToLayerType` from import-engine for test compatibility
- Worker now imports from `@felt-like-it/import-engine` -- parsing convergence is **complete**
- DB insertion convergence is the **remaining gap** (next phase)

---

## 5. Architecture Diagram (Updated)

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
                    |  (431 LOC)|   delegates to import-engine
                    +-----+-----+   raw SQL inserts to PostGIS
                          |
                          |  import-engine (970 LOC)
                          |  +-----------+----------+
                          |  | geojson   | csv      |
                          |  | shapefile | kml/gpx  |
                          |  | geopackage| sanitize |
                          |  +-----------+----------+
                          |        ^
                          |        | (also used by)
                          |  +-----+-------+
                          |  | Web Import  |
                          |  | Wrappers    |
                          |  | (336 LOC)   |
                          |  +-----+-------+
                          |        | (unused in async path,
                          |        |  available for sync import)
                          |
                     PostgreSQL
                    (PostGIS 4326)
                          |
              +-----------+-----------+
              |                       |
        GET /api/job/[id]    GET /api/export/[layerId]
        (poll status)        (GeoJSON/GeoPackage/Shapefile/PDF)
```

---

Cross-references: [components](components.md) | [behavior](behavior.md) | [contracts](contracts.md)

<!--
PROPOSED_SEEDS:
[
  {"title": "Remove orphaned parser deps from web + worker package.json", "type": "task", "labels": ["data-pipeline", "deadwood", "cleanup"], "priority": "medium", "description": "papaparse, shpjs, @tmcw/togeojson, @xmldom/xmldom are orphaned in web and worker after import-engine extraction. sql.js stays in web (export uses it). ~8 deps to remove."},
  {"title": "Bump import-engine dep versions to match workspace (shpjs ^6.2.0, sql.js ^1.14.0)", "type": "task", "labels": ["data-pipeline", "version-drift"], "priority": "low", "description": "import-engine has older semver ranges than web/worker for shpjs and sql.js. Align to prevent confusion."},
  {"title": "Extract shared DB insertion module for web + worker import paths", "type": "task", "labels": ["data-pipeline", "duplication", "worker"], "priority": "high", "description": "Worker uses raw SQL for layer creation + feature batch insert + job status updates. Web uses Drizzle-backed shared.ts + geo/queries. Schema changes require dual updates. Extract shared module."},
  {"title": "Split worker/src/index.ts into per-format + db modules", "type": "task", "labels": ["data-pipeline", "worker", "maintainability"], "priority": "medium", "description": "431 LOC monolith with 6 process* functions + DB ops + lifecycle. Split into worker/src/formats/, worker/src/db.ts, worker/src/lifecycle.ts."}
]
-->
