# Import Worker — Contracts (L6)

> Subsystem: `services/worker/src/`

## 1. Input Contract: ImportJobPayload (Redis via BullMQ)

**Queue name**: `file-import`
**Source**: `apps/web/src/lib/server/jobs/queues.ts` → `enqueueImportJob()`
**Trigger**: `POST /api/upload` writes file to disk, creates DB row, enqueues job

```typescript
// packages/shared-types/src/schemas/job.ts
ImportJobPayload {
  jobId: string    // UUID — matches import_jobs.id (created by upload route)
  mapId: string    // UUID — target map
  layerName: string // User-provided or derived from filename
  filePath: string  // Absolute path on shared filesystem: $UPLOAD_DIR/<jobId>/<sanitized-filename>
  fileName: string  // Original filename (used for format detection via extname)
}
```

**Queue default job options** (set by producer, not worker):
- `attempts: 3` — max 3 tries
- `backoff: { type: 'exponential', delay: 2000 }` — 2s, 4s, 8s
- `removeOnComplete: 100` — keep last 100 completed jobs in Redis
- `removeOnFail: 500` — keep last 500 failed jobs

## 2. Output Contract: PostgreSQL Writes

The worker writes to **3 tables** via raw SQL:

### import_jobs (status tracking)

| Column | Worker Writes | When |
|--------|--------------|------|
| `status` | `'processing'` | Job start (line 75) |
| `status` | `'done'` | Success (line 96) |
| `status` | `'failed'` + `error_message` | Catch block (lines 101-106) |
| `progress` | 0-100 integer | Throughout processing |
| `layer_id` | UUID of created layer | After layer INSERT |
| `updated_at` | `NOW()` | Every status update |

**Status state machine**: `pending` (set by upload route) -> `processing` -> `done` | `failed`

### layers (one per import)

```sql
INSERT INTO layers (map_id, name, type, style, source_file_name)
VALUES ($mapId, $layerName, $layerType, $style::jsonb, $layerName)
RETURNING id
```

- `type`: detected via `detectLayerType()` from geo-engine (`'point'`|`'line'`|`'polygon'`|`'mixed'`)
- `style`: auto-generated via `generateAutoStyle()` from geo-engine
- `source_file_name`: set to `layerName` (not the original filename — potential bug?)

### features (batch inserts)

Two insert patterns:

**GeoJSON path** (geojson, csv, shapefile, kml, gpx):
```sql
INSERT INTO features (layer_id, geometry, properties)
VALUES ($layerId::uuid, ST_GeomFromGeoJSON($geojson), $properties::jsonb)
-- Multi-row: up to 500 rows per INSERT
```

**WKB path** (geopackage only):
```sql
INSERT INTO features (layer_id, geometry, properties)
VALUES ($layerId::uuid, ST_GeomFromWKB(decode($wkbHex, 'hex'), $srid), $properties::jsonb)
-- With optional ST_Transform(..., 4326) when srid != 4326
```

## 3. Filesystem Contract

**Read path**: `$UPLOAD_DIR/<jobId>/<sanitized-filename>`
- `UPLOAD_DIR` defaults to `/tmp/felt-uploads` (set by upload route)
- Worker reads `filePath` from payload verbatim — no validation that file exists before parsing
- **No cleanup**: Worker never deletes uploaded files after processing (endorheic basin)

**Shared filesystem requirement**: Upload route (web process) and worker must share the same
filesystem mount at `$UPLOAD_DIR`. In Docker, this means a shared volume.

## 4. Job Status Signaling

The worker signals completion/failure through **two channels**:

| Channel | Mechanism | Consumer |
|---------|-----------|----------|
| PostgreSQL `import_jobs` | Direct SQL UPDATE | Frontend polls via tRPC query |
| BullMQ job state | `throw err` re-throws to BullMQ | BullMQ retry logic |

**Critical interaction**: On failure, the worker first writes `status='failed'` to Postgres,
then re-throws to BullMQ. On retry, BullMQ re-delivers the job, and the worker's cleanup
code (lines 60-73) checks for a stale `layer_id` to delete partial data.

**Gap**: If the worker crashes mid-insert (OOM, SIGKILL), the Postgres row stays at
`status='processing'` forever — no external process resets stale `processing` jobs.
