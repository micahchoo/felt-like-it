# Data Pipeline Cluster — Components & Contracts

> Re-scanned 2026-03-29. Prior version described inline parsing; this version reflects the
> `@felt-like-it/import-engine` extraction and thin-wrapper refactor.

## Component Map

```
                    ┌──────────────────────────────┐
                    │  @felt-like-it/import-engine  │  Pure parsing — no DB, no IO side effects
                    │  packages/import-engine/      │  7 format parsers + sanitize + types
                    └──────────┬───────────────────┘
                               │ workspace:*
               ┌───────────────┼───────────────┐
               ▼               ▼               ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  Web Wrappers│  │    Worker    │  │   Export     │
    │  server/     │  │  services/   │  │  server/     │
    │  import/     │  │  worker/     │  │  export/     │
    │  (Drizzle)   │  │  (raw SQL)   │  │  (Drizzle)   │
    └──────┬───────┘  └──────┬───────┘  └──────────────┘
           │                 │
           ▼                 ▼
        PostGIS (features, layers, import_jobs)
```

## 1. `@felt-like-it/import-engine` (NEW)

**Location:** `packages/import-engine/`
**Role:** Pure format parsing — reads files, returns typed feature arrays. No database access, no side effects beyond filesystem reads.

### Modules

| File | Exports | Return type |
|------|---------|-------------|
| `geojson.ts` | `parseGeoJSON(filePath)` | `ParsedFeature[]` |
| `csv.ts` | `parseCSV(filePath)`, `csvRowsToFeatures(headers, rows)` | `ParsedCsv`, `ParsedFeature[]` |
| `shapefile.ts` | `parseShapefile(filePath)` | `ParsedFeature[]` |
| `kml.ts` | `parseKML(filePath)` | `ParsedFeature[]` |
| `gpx.ts` | `parseGPX(filePath)` | `ParsedFeature[]` |
| `geopackage.ts` | `parseGeoPackage(filePath)`, `parseGpkgBlob(blob)`, `gpkgGeomTypeToLayerType(name)` | `GeoPackageResult` (contains `ParsedWkbFeature[]`) |
| `sanitize.ts` | `sanitizeFilename(name)` | `string` |
| `types.ts` | `ParsedFeature`, `ParsedWkbFeature`, `ParsedCsv` | (type-only) |

### Design decisions

- **CSV geocoding stays out**: `parseCSV` returns raw `{headers, rows}`. Geocoding requires API keys and progress callbacks — consumers (web wrapper, worker) handle this.
- **GeoPackage returns WKB hex**, not GeoJSON geometry. Both consumers pass WKB directly to PostGIS via `ST_GeomFromWKB`, avoiding a lossy WKB-to-GeoJSON-to-WKB round-trip.
- **XML parsing uses `fast-xml-parser`**, replacing the prior `@tmcw/togeojson` + `@xmldom/xmldom` stack. This is a deliberate choice — fast-xml-parser has no DOM dependency.

### Dependencies

```
@felt-like-it/shared-types  workspace:*   (Geometry type)
@felt-like-it/geo-engine    workspace:*   (coordinate detection, validation)
papaparse                   ^5.4.1
shpjs                       ^6.1.0        ⚠ DRIFT — see §6
fast-xml-parser              ^4.5.0
sql.js                      ^1.12.0       ⚠ DRIFT — see §6
```

### Tests

7 test files: `csv`, `geojson`, `geopackage`, `gpx`, `kml`, `sanitize`, `shapefile`.
Coverage script: `vitest run --coverage`.

### TYPE_DEBT

`vendor.d.ts` contains minimal ambient typings for `sql.js` and `shpjs` — neither ships declaration files. Tracked with `// TYPE_DEBT:` markers.

## 2. Web Import Wrappers (REFACTORED)

**Location:** `apps/web/src/lib/server/import/`
**Role:** Thin wrappers — delegate parsing to `import-engine`, handle DB layer creation via Drizzle ORM.

### Delegation pattern

All wrappers follow the same shape:

```typescript
import { parseFoo } from '@felt-like-it/import-engine';
import { createLayerAndInsertFeatures } from './shared.js';

export async function importFoo(filePath, mapId, layerName, jobId) {
  const features = await parseFoo(filePath);          // pure parse
  return createLayerAndInsertFeatures({ ... });        // DB side effects
}
```

| Wrapper | Parser delegated to | Notable difference |
|---------|--------------------|--------------------|
| `geojson.ts` | `parseGeoJSON` | Minimal — textbook thin wrapper |
| `csv.ts` | `parseCSV` + `csvRowsToFeatures` | **Thickest wrapper**: handles geocoding path (address detection, Nominatim batch, progress callbacks) |
| `shapefile.ts` | `parseShapefile` | Minimal |
| `xmlgeo.ts` | `parseKML` / `parseGPX` | Format dispatch by `XmlGeoFormat` parameter |
| `geopackage.ts` | `parseGeoPackage` | WKB-specific: converts `wkbHex` to `Uint8Array` for `insertWkbFeatures`, does NOT use `shared.ts` helper |

### `shared.ts` — shared tail

`createLayerAndInsertFeatures`: detects layer type, generates auto-style, creates layer row, batch-inserts features (500-row batches via `insertFeatures`), tracks progress, returns `{layerId, featureCount, bbox}`.

Used by: geojson, csv, shapefile, xmlgeo. **Not** used by geopackage (needs WKB-specific insertion).

### `sanitize.ts` — re-export shim

```typescript
export { sanitizeFilename } from '@felt-like-it/import-engine';
```

Pure re-export. No local logic remains. Exists for backward-compatible imports from `server/import/sanitize.js`.

## 3. Worker (REFACTORED)

**Location:** `services/worker/src/index.ts`
**Role:** BullMQ consumer — dequeues import jobs, delegates parsing to `import-engine`, writes to PostGIS via raw SQL.

### Architecture

```
BullMQ 'file-import' queue
  → processImportJob (ext dispatch)
      ├─ processGeoJSON    → parseGeoJSON    → insertFeaturesBatch (ST_GeomFromGeoJSON)
      ├─ processCSV        → parseCSV + csvRowsToFeatures / geocodeBatch
      ├─ processShapefile  → parseShapefile  → insertFeaturesBatch
      ├─ processXmlGeo     → parseKML/GPX    → insertFeaturesBatch
      └─ processGeoPackage → parseGeoPackage → WKB batch insert  (ST_GeomFromWKB)
```

**Key difference from web wrappers:** Worker uses raw SQL (`db.execute(sql\`...\`)`) instead of Drizzle query builder. Each `process*` function handles its own layer creation + batch insert inline. There is **no shared tail** equivalent to `shared.ts` — each function duplicates the create-layer + batch-insert pattern (~30 LOC each).

### `insertFeaturesBatch` (worker-local)

Generic batch inserter for GeoJSON-geometry formats. 500-row multi-value INSERT per batch using `ST_GeomFromGeoJSON`. GeoPackage has its own loop using `ST_GeomFromWKB`/`ST_Transform`.

## 4. Export Pipeline (UNCHANGED)

**Location:** `apps/web/src/lib/server/export/`

| File | Format | Method |
|------|--------|--------|
| `shared.ts` | Common | `getExportData` — loads layer features via `ST_AsGeoJSON` |
| `geopackage.ts` | `.gpkg` | sql.js in-memory SQLite + WKB |
| `shapefile.ts` | `.shp/.zip` | `@mapbox/shp-write` |
| `pdf.ts` | `.pdf` | pdfkit screenshot |

**Risk persists:** Entire dataset loaded into memory before response. No streaming.

Export does NOT use `import-engine` — it has its own sql.js/WKB logic for GeoPackage writing (inverse of parsing).

## 5. Stratigraphy

### FAULTS (structural inconsistencies)

| ID | Fault | Severity | Detail |
|----|-------|----------|--------|
| F1 | **Dual DB access pattern** | Medium | Web wrappers use Drizzle ORM; worker uses raw `sql` template literals. Same tables, different code paths. Bug fixes to insert logic must be applied in both. |
| F2 | **No shared insert tail in worker** | Low | Worker duplicates create-layer + batch-insert across 5 `process*` functions (~150 LOC total). Web wrappers solved this with `shared.ts`. |
| F3 | **Stale deps in worker package.json** | Low | `@tmcw/togeojson` (^7.1.2) and `@xmldom/xmldom` (^0.8.11) are listed as dependencies but **not imported anywhere** in worker source. These are vestigial from pre-extraction. Same in web package.json. |
| F4 | **GeoPackage hex-to-bytes conversion** | Info | `geopackage.ts` wrapper converts `wkbHex` string back to `Uint8Array` for `insertWkbFeatures`. The import-engine produces hex; the wrapper undoes it. A `wkbBytes` field on `ParsedWkbFeature` would avoid the round-trip. |

### DIAGENESIS (temporary patterns becoming permanent)

| ID | Pattern | Status | Detail |
|----|---------|--------|--------|
| D1 | `sanitize.ts` re-export shim | **Stable** | Pure re-export. Exists only for backward-compatible import paths. Harmless but could be removed when all consumers update imports. |
| D2 | `vendor.d.ts` ambient typings | **Stable** | `sql.js` and `shpjs` still lack official types. TYPE_DEBT markers are in place. Will persist until upstream ships declarations or community `@types/` packages appear. |
| D3 | `papaparse` duplicate dep | **Stable** | Listed in both import-engine and worker package.json. Worker's copy is vestigial (not directly imported) but may be hoisted by pnpm. |

## 6. Version Drift

| Dependency | import-engine | worker | web |
|------------|:------------:|:------:|:---:|
| `shpjs` | ^6.1.0 | ^6.2.0 | ^6.2.0 |
| `sql.js` | ^1.12.0 | ^1.14.0 | ^1.14.0 |
| `papaparse` | ^5.4.1 | ^5.4.1 | ^5.4.1 |
| `@types/papaparse` | ^5.3.15 | ^5.3.14 | ^5.3.14 |

**Risk:** `shpjs` and `sql.js` version ranges diverge. Worker and web specify newer minimums (6.2.0, 1.14.0) than import-engine (6.1.0, 1.12.0). Since consumers also list these as direct deps, pnpm may resolve different versions depending on hoisting. If import-engine is the sole importer (worker and web delegate to it), the consumer-side direct deps are vestigial and should be removed — letting import-engine own the resolution.

## 7. Component Dependency Graph

```
import-engine ──→ shared-types (Geometry)
              ──→ geo-engine   (coordinate detection, validation)
              ──→ papaparse, shpjs, fast-xml-parser, sql.js

web/import/   ──→ import-engine (parsing)
              ──→ geo-engine    (geocoding, layer type, auto-style)
              ──→ server/db     (Drizzle: layers, importJobs)
              ──→ server/geo    (insertFeatures, insertWkbFeatures, getLayerBbox)

worker/       ──→ import-engine (parsing)
              ──→ geo-engine    (geocoding, layer type, auto-style)
              ──→ pg + drizzle  (raw SQL: layers, features, import_jobs)
              ──→ bullmq + ioredis (job queue)

web/export/   ──→ server/geo    (getExportData via ST_AsGeoJSON)
              ──→ sql.js        (GeoPackage write — independent of import-engine)
              ──→ @mapbox/shp-write, pdfkit
```

## Inter-Process Contract (UNCHANGED)

### ImportJobPayload (shared-types)
```typescript
{ jobId: uuid, mapId: uuid, layerName: string, filePath: string, fileName: string }
```

- Transport: Redis BullMQ queue
- No schema validation on dequeue — worker trusts payload
- `filePath` is absolute filesystem path — both processes must share filesystem

### Filesystem Contract
- Upload dir: `UPLOAD_DIR ?? '/tmp/felt-uploads'`
- Layout: `<UPLOAD_DIR>/<jobId>/<sanitized-filename>`
- **No cleanup:** Files persist indefinitely after job completion/failure

## Geoprocessing Interface (UNCHANGED)

Entry: `runGeoprocessing(op: GeoprocessingOp, newLayerId: string)`

9 operations (all single SQL round-trip):
buffer, convex_hull, centroid, dissolve, intersect, union, clip, point_in_polygon, nearest_neighbor, aggregate

**Risk:** No transaction wrapping — partial results committed on failure.

## Security Assessment (UPDATED)

| Area | Finding | Severity | Change |
|------|---------|----------|--------|
| XML parsing (KML/GPX) | `fast-xml-parser` replaces `@xmldom/xmldom` — no DOM, no entity resolution by default | Low | Improved |
| GeoPackage SQL | `tableName` validated by regex in import-engine; `geomColName` from file metadata (validated by existence check, not regex) | Medium | Unchanged |
| File upload | `sanitizeFilename` now in import-engine — shared between all consumers | Low | Improved |
| Worker SQL | Drizzle `sql` template (parameterized); UUID casts add DB-level validation | Low | Unchanged |
| Feature properties | Stored raw as JSONB; no sanitization — XSS if rendered as HTML | Medium | Unchanged |

**See also:** [contracts](contracts.md) | [modules](modules.md) | [subsystems](../subsystems.md)
