# Data Pipeline — Behavior

> Zoom level: **behavior** (runtime flow traces, endorheic basins, stream capture)
> Lenses: **Data**, **Security**
> Cross-references: [contracts](contracts.md) | [modules](modules.md)

## Architecture: Three-Layer Parse/Persist Split

```
┌─────────────────────────────────────────────────────────────────┐
│  import-engine (pure functions, no side effects)                │
│  parseGeoJSON · parseCSV · csvRowsToFeatures · parseShapefile   │
│  parseKML · parseGPX · parseGeoPackage · sanitizeFilename       │
│  Returns: ParsedFeature[] or { ParsedWkbFeature[], layerType }  │
└──────────────────────────┬──────────────────────────────────────┘
                           │ ParsedFeature[] / ParsedWkbFeature[]
         ┌─────────────────┼─────────────────┐
         ▼                                   ▼
┌─────────────────────┐           ┌───────────────────────────┐
│ server/import/       │           │ services/worker/           │
│ (thin wrappers)      │           │ (BullMQ processor)         │
│ Drizzle ORM          │           │ raw SQL via drizzle + pool │
│ shared.ts tail       │           │ inline batch INSERT        │
│ → FB-2 (sync)        │           │ → FB-1 (async)             │
└─────────────────────┘           └───────────────────────────┘
```

**Key invariant:** import-engine never touches the database, Redis, or filesystem beyond
reading the input file. All persistence is the caller's responsibility.

---

## FB-1: Async Import (Worker)

**Path:** Client upload → API enqueue → BullMQ `file-import` queue → Worker → PostGIS

```
1. Client POST /api/import → creates import_jobs row (status='pending')
     → BullMQ.add('file-import', { jobId, mapId, layerName, filePath, fileName })

2. Worker dequeues (concurrency: 3, Redis connection)
     → processImportJob(job)

3. Retry cleanup: if import_jobs.layer_id is set from a previous failed attempt
     → DELETE features WHERE layer_id = stale
     → DELETE layers WHERE id = stale
     → SET import_jobs.layer_id = NULL

4. Dispatch by file extension:
     .geojson/.json → processGeoJSON → parseGeoJSON(filePath)
     .csv           → processCSV     → parseCSV(filePath) → coord path or geocode path
     .zip/.shp      → processShapefile → parseShapefile(filePath)
     .kml           → processXmlGeo → parseKML(filePath)
     .gpx           → processXmlGeo → parseGPX(filePath)
     .gpkg          → processGeoPackage → parseGeoPackage(filePath)

5. Each processor:
     → import-engine parser returns ParsedFeature[] (or ParsedWkbFeature[] for .gpkg)
     → Layer type detection (detectLayerType) + auto-style (generateAutoStyle)
     → Raw SQL: INSERT INTO layers ... RETURNING id
     → UPDATE import_jobs SET layer_id, progress=10-15
     → Batch INSERT INTO features (500 rows/batch)
       - GeoJSON path: ST_GeomFromGeoJSON(geometry_json)
       - GeoPackage path: ST_GeomFromWKB(decode(wkb_hex, 'hex'), srid)
         with ST_Transform for non-4326 SRIDs
     → Progress: 5 → 10-15 → linear 15-95 → 100

6. CSV geocoding path (special):
     → detectCoordinateColumns(headers) → null
     → detectAddressColumn(headers) → finds address column
     → geocodeBatch(addresses, progressCb, { rateDelayMs: 1100 })
     → Nominatim at 1100ms/request — silently drops failed rows
     → If ALL fail → throw Error → job status='failed'

7. On success: updateJobStatus(jobId, 'done', 100)
   On failure: UPDATE import_jobs SET status='failed', error_message=...
     → BullMQ receives the re-thrown error for its retry logic

8. Client polls GET /api/job/[jobId] → reads import_jobs row
```

**ORM strategy:** Worker uses raw `drizzle-orm/sql` template literals against a direct
`pg.Pool`. No Drizzle schema objects — all SQL is inline string templates.

### CSV Dual Path Detail

```
parseCSV(filePath)                    ← import-engine: PapaParse streaming
  → { headers, rows }
  │
  ├─ detectCoordinateColumns(headers) → { latCol, lngCol }
  │    → csvRowsToFeatures(headers, rows)   ← import-engine: pure
  │    → ParsedFeature[] (Point geometries)
  │
  └─ detectAddressColumn(headers) → addrCol
       → geocodeBatch(addresses, progressCb)  ← geo-engine: Nominatim
       → manually construct Point features from results
       → silently drop rows where geocoding failed
```

**Design decision:** Geocoding stays out of import-engine. It needs API keys,
rate-limiting, and progress callbacks — side effects that violate the pure-function contract.

---

## FB-2: Sync Import (Server Thin Wrappers)

**Path:** tRPC call → server/import/\*.ts → import-engine → Drizzle ORM → PostGIS

```
1. tRPC handler calls importGeoJSON / importCSV / importShapefile /
   importXmlGeo / importGeoPackage with (filePath, mapId, layerName, jobId)

2. Thin wrapper:
     → Calls import-engine parser (parseGeoJSON, parseCSV, etc.)
     → Returns ParsedFeature[] (or ParsedWkbFeature[] for gpkg)

3. Shared tail — createLayerAndInsertFeatures(opts):
     → detectLayerType(geometry hints) — or layerTypeOverride for CSV
     → generateAutoStyle(layerType, property hints)
     → db.insert(layers).values(...).returning()
     → db.update(importJobs).set({ layerId, progress: 10, status: 'processing' })
     → Loop: insertFeatures(layerId, batch) — 500 rows/batch
       → Progress: 10 → linear 10-90
     → getLayerBbox(layerId)
     → Return { layerId, featureCount, bbox }

4. GeoPackage exception: importGeoPackage does NOT use shared.ts.
     → Has its own batch-insert loop using insertWkbFeatures()
     → Converts wkbHex → Uint8Array for WKB insertion
     → Uses Drizzle schema objects (db, layers, importJobs from '../db/')
```

**ORM strategy:** Thin wrappers use Drizzle schema objects (`layers`, `importJobs`,
`insertFeatures`, `insertWkbFeatures`) — proper typed ORM, not raw SQL.

### Wrapper Uniformity

| Module       | Parser call              | Uses shared.ts? | Special handling          |
|-------------|--------------------------|-----------------|---------------------------|
| geojson.ts  | `parseGeoJSON(filePath)` | Yes             | None                      |
| shapefile.ts| `parseShapefile(filePath)`| Yes            | None                      |
| xmlgeo.ts   | `parseKML` / `parseGPX`  | Yes             | Format param selects parser|
| csv.ts      | `parseCSV(filePath)`     | Yes             | Geocoding path, layerTypeOverride='point' |
| geopackage.ts| `parseGeoPackage(filePath)`| **No**        | Own WKB batch-insert loop |
| sanitize.ts | Re-export only           | N/A             | `sanitizeFilename` pass-through |

---

## Endorheic Basins

### EB-1: Uploaded Files Never Cleaned Up (CONFIRMED)

Neither FB-1 nor FB-2 deletes the uploaded file after import completes or fails.
The `filePath` in ImportJobPayload points to a file on disk that persists indefinitely.

- **Worker:** `processImportJob` reads `filePath` but never calls `unlink()`.
- **Server wrappers:** Same — all wrappers pass `filePath` to import-engine, never delete.
- **No TTL:** No cron job, no background cleaner, no filesystem watcher detected.
- **Growth rate:** One file per import attempt. Failed retries re-read the same file (good),
  but the file still isn't cleaned up after final success or failure.

**Severity:** Medium. Disk fills over time. Mitigated only by external cleanup (OS tmpwatch,
Docker volume pruning, etc.) which is not configured in this codebase.

### EB-2: BullMQ Completed/Failed Jobs Accumulate in Redis (LIKELY)

The worker creates a `new Worker('file-import', ...)` with no `removeOnComplete` or
`removeOnFail` configuration. BullMQ defaults:
- `removeOnComplete: false` — completed jobs stay in Redis forever
- `removeOnFail: false` — failed jobs stay in Redis forever

Each job stores its full payload (`jobId, mapId, layerName, filePath, fileName`).
Over time, Redis memory grows proportionally to total import count.

**Severity:** Low-Medium. Job payloads are small (~200 bytes), but the set is unbounded.
BullMQ's default retention means `LLEN bull:file-import:completed` grows monotonically.

### EB-3: import_jobs Table Has No Lifecycle (CONFIRMED)

The `import_jobs` table receives rows on upload and status updates during processing,
but there is no archival, TTL column, or cleanup query anywhere in the codebase.
Terminal states (`done`, `failed`) accumulate indefinitely.

**Severity:** Low. PostgreSQL handles large tables well, but query performance on
`WHERE status = 'pending'` degrades without an index on status (not verified here).

### EB-4: Partial Layer Cleanup Only on Retry (SCOPED)

The worker cleans up stale layers/features from a previous failed attempt only when
BullMQ retries the same job. If a job fails and is NOT retried (max retries exhausted),
the partial layer and its features remain in the database with no import_jobs reference
pointing to a successful import.

**Severity:** Low. Orphaned layers are invisible to the UI (import_jobs.status='failed'),
but they consume PostGIS storage.

---

## Stream Capture Assessment

**Question:** Did import-engine absorb too much or too little?

### What import-engine absorbed (correct)

| Responsibility | Location | Pure? |
|---------------|----------|-------|
| File I/O + format parsing | All parsers | Yes (reads file, returns data) |
| GeoJSON validation | `parseGeoJSON` via `validateGeoJSON` | Yes |
| CSV streaming + header extraction | `parseCSV` via PapaParse | Yes |
| CSV coordinate conversion | `csvRowsToFeatures` | Yes |
| Shapefile/zip unpacking | `parseShapefile` via shpjs | Yes |
| KML/GPX XML parsing | `parseKML`/`parseGPX` via fast-xml-parser | Yes |
| GeoPackage SQLite read + WKB extraction | `parseGeoPackage` via sql.js | Yes |
| GP Binary header stripping | `parseGpkgBlob` | Yes |
| Filename sanitization | `sanitizeFilename` | Yes |
| Table name validation | `isValidTableName` | Yes |

### What stayed in consumers (correct)

| Responsibility | Location | Why |
|---------------|----------|-----|
| Geocoding (Nominatim) | geo-engine + worker/server | Side effect: HTTP calls, rate limiting, API keys |
| Layer type detection | geo-engine | Shared utility, not format-specific |
| Auto-style generation | geo-engine | Shared utility |
| Database persistence | worker (raw SQL) / server (Drizzle ORM) | Side effect: DB writes |
| Progress tracking | worker/server | Side effect: DB updates |
| Job status management | worker/server | Side effect: DB updates |
| BullMQ queue integration | worker only | Infrastructure concern |

### Capture verdict: WELL-CALIBRATED

Import-engine drew the boundary at the right place: pure parsing in, side effects out.
Two minor observations:

1. **File I/O is inside import-engine** — every parser does `readFile(filePath)`. This is
   a side effect, but it's the minimal necessary one. Accepting a `Buffer` instead would
   let consumers control I/O, but adds no practical benefit here.

2. **GeoPackage wrapper diverges from shared.ts** — `server/import/geopackage.ts` has its
   own batch-insert loop instead of using `createLayerAndInsertFeatures`. This is because
   WKB features need `insertWkbFeatures` (different from `insertFeatures`), so the
   divergence is structurally motivated, not accidental.

---

## Security Observations (Data + Security Lenses)

| Vector | Status | Location |
|--------|--------|----------|
| Path traversal via filename | **Mitigated** | `sanitizeFilename` strips dirs, replaces unsafe chars |
| SQL injection via GeoPackage table name | **Mitigated** | `isValidTableName` regex + quoted identifiers in query |
| GeoPackage SQL injection via column values | **Mitigated** | Properties extracted by column index, not interpolated into SQL |
| JSON injection via properties | **Mitigated** | `JSON.stringify(properties)::jsonb` — PostgreSQL validates |
| Geocoding SSRF | **Low risk** | Nominatim URL from env var, not user input |
| Unbounded file size | **NOT mitigated** | No file size limit in worker or parsers; `readFile` loads entire file into memory |
| GeoPackage entire-file-in-memory | **Inherited** | sql.js loads full .gpkg as `Uint8Array` — OOM on large files |

---

## Dual-Path Divergence Summary

The worker (FB-1) and server wrappers (FB-2) both call import-engine parsers but diverge
on everything after parsing:

| Concern | FB-1 (Worker) | FB-2 (Server Wrappers) |
|---------|---------------|------------------------|
| ORM | Raw SQL templates | Drizzle schema objects |
| Batch insert | `insertFeaturesBatch` (inline) | `insertFeatures` (from geo/queries) |
| GeoPackage insert | Inline WKB SQL | `insertWkbFeatures` (from geo/queries) |
| Progress tracking | `updateJobStatus` (inline) | `db.update(importJobs).set(...)` |
| Layer creation | Raw `INSERT INTO layers` | `db.insert(layers).values(...)` |
| Shared tail | None — each processor is standalone | `createLayerAndInsertFeatures` in shared.ts |
| File cleanup | None | None |

This divergence means bug fixes to batch insertion must be applied in two places.
The worker's inline SQL and the server's Drizzle queries are semantically equivalent
but syntactically independent.
