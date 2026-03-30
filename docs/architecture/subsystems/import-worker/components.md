# Import Worker — Components (L5 Component + L7 Module)

> Subsystem: `services/worker/src/`
> Risk: High (no test files, raw SQL via Drizzle `sql` template, separate Docker process)

## File Structure

```
services/worker/
  src/
    index.ts       — 431 LOC: job consumer, 6 format processors, batch insert, status updates, shutdown
    logger.ts      — 12 LOC: pino logger with pino-pretty in dev
    shpjs.d.ts     — type declaration for untyped shpjs dependency (DEADWOOD — see below)
  package.json
  tsconfig.json
```

**Monolith index.ts** — all logic lives in a single file. No internal module boundaries.

## Component Inventory

| Component | Lines | Role |
|-----------|-------|------|
| DB connection (pg.Pool + Drizzle) | 38-43 | `pg.Pool` with max 5 connections, Drizzle wrapper |
| Redis connection | 47-50 | ioredis for BullMQ, `maxRetriesPerRequest: null` |
| `processImportJob()` | 54-108 | Top-level job handler: retry cleanup, format dispatch, error catch |
| `processGeoJSON()` | 110-143 | Parse via import-engine, detect type + style via geo-engine |
| `processCSV()` | 145-237 | Two paths: lat/lng columns (Path A) or address geocoding (Path B) |
| `processShapefile()` | 267-298 | Parse .zip/.shp via import-engine |
| `processXmlGeo()` | 300-340 | KML and GPX via import-engine |
| `processGeoPackage()` | 342-386 | WKB binary path with SRID-aware ST_Transform |
| `insertFeaturesBatch()` | 239-265 | Generic batch inserter: 500 features/batch, multi-row INSERT |
| `updateJobStatus()` | 388-398 | Simple UPDATE on import_jobs |
| Worker setup | 402-431 | BullMQ Worker, event listeners, graceful shutdown |

## Stratigraphy (L5)

**Raw SQL via Drizzle `sql` tagged template — intentional, not metamorphic.**

The worker uses `drizzle-orm` but exclusively through `db.execute(sql\`...\`)` and `pool.query()`.
This is **not** accidental regression from an ORM migration — it's a deliberate choice:
- The worker has no Drizzle schema imports (no `import { layers, features } from ...`)
- PostGIS functions (`ST_GeomFromGeoJSON`, `ST_GeomFromWKB`, `ST_Transform`) require raw SQL
- Multi-row INSERT with dynamic value clauses uses `sql.join()` — Drizzle's query builder

The `pool.query()` usage in retry cleanup (lines 60-73) is the one true raw SQL bypass — it
predates the Drizzle integration and uses parameterized queries directly.

## Deadwood (L7)

### Unused Dependencies in package.json

| Dependency | Status | Evidence |
|-----------|--------|----------|
| `@node-rs/argon2` | **DEAD** | Not imported anywhere in `src/`. Auth hashing has no role in worker |
| `@tmcw/togeojson` | **DEAD** | Not imported. KML/GPX parsing moved to `@felt-like-it/import-engine` |
| `@xmldom/xmldom` | **DEAD** | Not imported. Was the DOM parser for togeojson |
| `papaparse` | **DEAD** | Not imported. CSV parsing moved to import-engine |
| `shpjs` | **DEAD** | Not imported. Shapefile parsing moved to import-engine |
| `sql.js` | **DEAD** | Not imported. GeoPackage parsing moved to import-engine |
| `zod` | **DEAD** | Not imported. Validation is in shared-types |
| `@types/papaparse` | **DEAD** | Corresponds to unused papaparse |
| `@types/sql.js` | **DEAD** | Corresponds to unused sql.js |

**`shpjs.d.ts`** — type declaration for the now-unused `shpjs` import. Also deadwood.

**9 unused dependencies + 1 dead type declaration file** — all fossils from the pre-import-engine era
when the worker contained its own parsers (686 LOC, per mulch decision mx-8bec74).

### Duplication Check (L7)

No parser logic duplication — all 6 format parsers delegate to `@felt-like-it/import-engine`.
The worker's remaining ~400 LOC is purely orchestration (DB writes, progress tracking, retry cleanup).

**Exception**: `processGeoPackage()` duplicates the batch insert loop (lines 366-386) instead of
using `insertFeaturesBatch()` — because GeoPackage features use WKB binary (`ST_GeomFromWKB`) rather
than GeoJSON (`ST_GeomFromGeoJSON`). This is a legitimate divergence, not copy-paste debt.
