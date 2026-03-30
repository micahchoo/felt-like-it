# Import Worker — Behavior (L8)

> Subsystem: `services/worker/src/`

## 1. Full Async Import Trace

```
Upload Route (web)                    BullMQ (Redis)                  Worker Process
─────────────────                     ──────────────                  ──────────────
POST /api/upload
  ├─ auth check
  ├─ map access check
  ├─ write file to disk
  │   $UPLOAD_DIR/<jobId>/<name>
  ├─ INSERT import_jobs (pending)
  └─ queue.add('import', payload)
        ──────────────────────────────►
                                      job stored in Redis
                                      ─────────────────────────────►
                                                                    processImportJob(job)
                                                                      ├─ retry cleanup:
                                                                      │   SELECT layer_id FROM import_jobs
                                                                      │   if stale: DELETE features, layers
                                                                      ├─ UPDATE status='processing', progress=5
                                                                      ├─ extname(fileName) → format dispatch
                                                                      ├─ parse file (import-engine)
                                                                      ├─ detectLayerType + generateAutoStyle
                                                                      ├─ INSERT INTO layers → layerId
                                                                      ├─ UPDATE import_jobs SET layer_id
                                                                      ├─ insertFeaturesBatch (500/batch)
                                                                      │   ├─ multi-row INSERT INTO features
                                                                      │   └─ UPDATE progress per batch
                                                                      └─ UPDATE status='done', progress=100
```

### Progress Curve

| Phase | Progress | Notes |
|-------|----------|-------|
| Job start | 5% | Fixed |
| Layer created | 10-15% | 10% for geopackage, 15% for others |
| Feature insertion | 15-95% | Linear with batch completion |
| Done | 100% | Final update |

## 2. Error Handling

### Parse Failure
- Exception from import-engine propagates up
- Caught at line 98: writes `status='failed'` + `error_message` to Postgres
- Re-throws to BullMQ → triggers retry (up to 3 attempts)

### DB Failure
- `pool.query()` / `db.execute()` throws on connection error
- Same catch block: writes failed status (but if DB is down, this also fails)
- **No circuit breaker** — worker will keep retrying against a dead database

### File Not Found
- import-engine throws (e.g., `ENOENT` from `readFile`)
- Caught and marked as failed
- **Will retry 3 times** even though the file won't appear — wasted retries

### Empty Data
- CSV: explicit check `rows.length === 0` → `Error('CSV file is empty')`
- KML/GPX: explicit check `features.length === 0` → descriptive error
- GeoJSON/Shapefile: no explicit empty check — will create layer with 0 features (silent success)
- GeoPackage: no explicit empty check — same silent success

### Geocoding Failure (CSV Path B)
- All addresses fail → `Error('Geocoding failed for all N rows')`
- Partial failure → silently drops rows that failed geocoding (no warning logged)

## 3. Retry Logic

**Configuration** (set by producer in `queues.ts`):
- Max attempts: 3
- Backoff: exponential starting at 2000ms (2s → 4s → 8s)

**Retry cleanup** (worker-side, lines 60-73):
Before processing, checks if `import_jobs.layer_id IS NOT NULL`:
1. `DELETE FROM features WHERE layer_id = $staleLayerId`
2. `DELETE FROM layers WHERE id = $staleLayerId`
3. `UPDATE import_jobs SET layer_id = NULL`

This handles the case where a previous attempt created a layer + some features before crashing.

**Cleanup gap on exhaustion**: After 3 failed attempts, BullMQ moves the job to the failed set.
The worker's `'failed'` event handler only logs — no cleanup of:
- Uploaded files on disk (`$UPLOAD_DIR/<jobId>/`)
- Partial layers/features (if the failed status write succeeded but retry cleanup didn't run)

## 4. Endorheic Basins (confirmed from Wave 3)

### Basin 1: Uploaded Files Never Deleted
- Upload route writes to `$UPLOAD_DIR/<jobId>/<filename>`
- Worker reads the file but never deletes it
- No cron job or cleanup process exists
- **Impact**: Disk fills up over time. 100MB max per upload.

### Basin 2: Stale `processing` Jobs
- If worker is SIGKILL'd or OOM'd mid-import:
  - `import_jobs.status` remains `'processing'` forever
  - BullMQ may redeliver (if the worker reconnects) but the DB row is never reset by any external sweep
- **Impact**: Frontend shows import "stuck" at some progress percentage indefinitely

### Basin 3: Failed Job Accumulation in Redis
- `removeOnFail: 500` keeps the last 500 failed jobs in Redis
- No TTL — old failed jobs persist until displaced by newer failures
- Not a critical issue but adds memory pressure if failure rate is high

## 5. Concurrency

```typescript
const worker = new Worker<ImportJobPayload>('file-import', processImportJob, {
  connection,
  concurrency: 3,
});
```

- **3 concurrent jobs** — each job gets its own `processImportJob()` invocation
- All share the same `pg.Pool` (max 5 connections) — 3 concurrent jobs with batch inserts
  could saturate the pool during heavy INSERT phases
- All share the same Redis connection (fine — ioredis multiplexes)

### Concurrency Risk: Pool Exhaustion
With 3 concurrent jobs, worst case each holds a connection during batch insert loops.
`pg.Pool` max is 5, leaving only 2 for status updates from other concurrent jobs.
Under load, `pool.query()` calls in retry cleanup could block waiting for a connection.

## 6. Graceful Shutdown

```typescript
process.on('SIGTERM', shutdown);  // Docker stop
process.on('SIGINT', shutdown);   // Ctrl+C
```

Shutdown sequence: `worker.close()` → `connection.quit()` → `pool.end()` → `process.exit(0)`

`worker.close()` tells BullMQ to finish active jobs before stopping — in-flight imports
will complete. However, there's no timeout — a slow geocoding job could delay shutdown indefinitely.

## 7. Summary of Issues

| # | Issue | Severity | Category |
|---|-------|----------|----------|
| 1 | 9 unused dependencies in package.json | Low | Deadwood |
| 2 | No uploaded file cleanup | Medium | Endorheic basin |
| 3 | No stale `processing` job sweep | Medium | Endorheic basin |
| 4 | File-not-found wastes all 3 retries | Low | Wasted work |
| 5 | GeoJSON/Shapefile/GeoPackage allow 0-feature imports | Low | Silent success |
| 6 | `source_file_name` set to `layerName` not original filename | Low | Data accuracy |
| 7 | No shutdown timeout for in-flight jobs | Low | Shutdown risk |
| 8 | Partial geocoding silently drops rows without logging | Low | Observability |
| 9 | Pool exhaustion possible under 3 concurrent heavy imports | Low | Resource contention |
| 10 | No test files for the worker process | High | Test coverage |
