# Data Pipeline Cluster — Components & Contracts

## Import Pipeline Architecture

```
Browser (ImportDialog)
  → POST /api/upload (multipart: file, mapId, layerName)
      ├─ auth + size check (≤ 100 MB) + requireMapAccess('editor')
      ├─ sanitizeFilename + write to UPLOAD_DIR/<jobId>/<filename>
      ├─ INSERT import_jobs (status='pending')
      └─ enqueueImportJob(ImportJobPayload) → BullMQ 'file-import' queue

Worker (services/worker, concurrency=3)
  ← dequeues job
      ├─ ext dispatch: processGeoJSON | processCSV | processShapefile
      │                processXmlGeo | processGeoPackage
      ├─ each: INSERT layer RETURNING id → insertFeaturesBatch (500-row batches)
      ├─ on success: status='done', progress=100
      └─ on failure: status='failed', retry 3× exponential
         cleanupPreviousAttempt(jobId) → deleteLayer(existingLayerId) on retry

Browser polling: GET /api/job/[jobId] → { status, progress, layerId }
```

**Dual implementation risk:** Worker reimplements ALL format parsers inline (669 LOC) instead of using the shared `server/import/` library. Bug fixes must be applied twice.

## Export Pipeline

```
GET /api/export/[layerId]?format=geojson|gpkg|shp
  → getExportData(layerId) → getLayerFeatures() via ST_AsGeoJSON
  → format dispatch:
      geojson → JSON.stringify(FeatureCollection)
      gpkg    → sql.js in-memory SQLite → WKB
      shp     → @mapbox/shp-write → zipped .shp/.dbf/.shx/.prj
POST /api/export/[layerId] → PDF screenshot
```

**Risk:** Entire dataset loaded into memory before response. No streaming.

## Inter-Process Contract

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

## Geoprocessing Interface

Entry: `runGeoprocessing(op: GeoprocessingOp, newLayerId: string)`

9 operations (all single SQL round-trip):
buffer, convex_hull, centroid, dissolve, intersect, union, clip, point_in_polygon, nearest_neighbor, aggregate

**Risk:** No transaction wrapping — partial results committed on failure.

## Security Assessment

| Area | Finding | Severity |
|------|---------|----------|
| XML parsing (KML/GPX) | @xmldom/xmldom doesn't resolve external entities by default; low practical XXE risk | Low |
| GeoPackage SQL | `tableName` validated by regex; `geomColName` unvalidated (from user file) | Medium |
| File upload | sanitizeFilename + startsWith check; file.size from client-reported Content-Length | Low |
| Worker SQL | Drizzle `sql` template (parameterized); UUID casts add DB-level validation | Low |
| Feature properties | Stored raw as JSONB; no sanitization — XSS if rendered as HTML | Medium |

**See also:** [behavior](behavior.md) | [subsystems](../subsystems.md)
