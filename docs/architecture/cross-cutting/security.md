# Cross-Cutting Security Assessment

> Updated 2026-03-29 with Wave 3 deep-drill findings.

## Critical

None — initially flagged findings were **disproved by deep drill**:
- `hooks.server.ts` checks `disabledAt` upstream, invalidates session, sets `locals.user = null`
- `admin.toggleDisabled` calls `lucia.invalidateUserSessions(userId)` on disable
- All REST v1 handlers call `resolveAuth()` — 100% coverage verified

## High

| Finding | Subsystem | Impact | Status |
|---------|-----------|--------|--------|
| CI has no test/lint/security gate | Infrastructure | Tests exist (73 files) but are not enforced. Regressions ship silently. | OPEN |
| Default admin password 'admin' in seed | Infrastructure | No forced change on first login. | OPEN |
| Worker has no tests | Data Pipeline | Raw SQL bulk insert bypasses ORM validation. | OPEN |
| Import file cleanup missing | Data Pipeline | Files persist in UPLOAD_DIR indefinitely → disk exhaustion. Confirmed as endorheic basin EB-1. | OPEN |
| **Worker `filePath` not re-validated** (NEW) | Data Pipeline | Worker reads `filePath` from Redis queue without checking it is within `UPLOAD_DIR`. `sanitizeFilename` and `startsWith(jobDir)` check happen only at the upload route (web side). If Redis is compromised, attacker controls file path → arbitrary file read. | OPEN |

## Medium

| Finding | Subsystem | Impact | Status |
|---------|-----------|--------|--------|
| Rate limiter in-memory only | Auth/API | Resets on restart, doesn't work multi-process. tRPC has zero rate limiting. | OPEN |
| REST v1 per-handler auth pattern | API | Missing `resolveAuth()` call = unauthenticated endpoint. | OPEN |
| API key scope: no DB constraint | API | Text column accepts invalid values. | OPEN |
| geomColName unvalidated in GeoPackage | Data Pipeline | User-controlled column name from .gpkg file. `tableName` validated by regex in import-engine, but `geomColName` validated only by existence check, not regex. | OPEN |
| **Feature properties: unlimited JSONB** (UPDATED) | Data Pipeline | Worker passes `JSON.stringify(f.properties)::jsonb` to raw SQL. No size limit, no depth limit, no key-count limit on the properties object. Two risks: (1) storage exhaustion via crafted imports with megabyte-sized property objects, (2) stored XSS if frontend renders property values as HTML. | OPEN |
| **Dual XML parser during transition** (NEW) | Data Pipeline | `import-engine` uses `fast-xml-parser` (no DOM, no entity resolution). But `@tmcw/togeojson` + `@xmldom/xmldom` remain as orphaned dependencies in `apps/web` and `services/worker` `package.json`. While no code imports them, they remain in the dependency tree — a supply-chain surface. The transition is functionally complete but not cleaned up. | OPEN |
| Worker duplicates all DB insertion logic | Data Pipeline | Raw SQL in worker vs Drizzle ORM in web wrappers. Schema changes require dual updates. Bug fix in one location doesn't fix the other. | OPEN |
| SESSION_SECRET has dev default | Infrastructure | `'change-me-in-production...'` in docker-compose.yml. | OPEN |
| Martin pinned to :latest | Infrastructure | Silent breaking changes on redeploy. | OPEN |
| **wkbHex passthrough without full validation** (NEW) | Data Pipeline | Worker passes `decode(${r.wkbHex}, 'hex')` to PostGIS. Only validated by `parseGpkgBlob` header check (magic bytes + offset), not full WKB structural validation. Malformed WKB could cause PostGIS errors or unexpected geometry. | OPEN |

## Low

| Finding | Subsystem | Impact | Status |
|---------|-----------|--------|--------|
| No per-map API key scoping | API | Leaked key exposes all user's maps. | OPEN |
| Audit lock bottleneck (key=1) | Auth | All audit writes serialize globally. | OPEN |
| Docker socket mounted to Traefik | Infrastructure | Privilege escalation vector (read-only mitigates). | OPEN |
| **8 orphaned dependencies** (NEW) | Data Pipeline | `papaparse`, `shpjs`, `@tmcw/togeojson`, `@xmldom/xmldom` and their `@types/*` remain in web/worker `package.json` after import-engine extraction. Supply-chain surface — unused code that receives updates and could introduce vulnerabilities. | OPEN |
| **BullMQ jobs accumulate indefinitely** (NEW) | Data Pipeline | No TTL on completed/failed jobs. Endorheic basin EB-2. Redis memory grows linearly with import count. | OPEN |
| **import_jobs table has no lifecycle** (NEW) | Data Pipeline | Terminal states (`done`, `failed`) accumulate indefinitely. No archival, TTL column, or cleanup query. Endorheic basin EB-3. | OPEN |

---

## Endorheic Basins (Resource Leak Summary)

Four confirmed resource accumulation points with no cleanup path:

| ID | Resource | Location | Growth Rate | Severity |
|----|----------|----------|-------------|----------|
| EB-1 | Uploaded files on disk | `UPLOAD_DIR` | 1 file per import attempt | HIGH — disk exhaustion |
| EB-2 | BullMQ completed/failed jobs | Redis | 1 entry per job | LOW — Redis memory |
| EB-3 | `import_jobs` table rows | PostgreSQL | 1 row per import | LOW — PG handles large tables |
| EB-4 | Orphaned partial layers | PostgreSQL `layers` table | On failed imports that created a layer before failure | MEDIUM — data pollution |

## Security Pins (Trust Boundary Violations)

Seven identified points where external/untrusted data crosses a trust boundary without adequate validation:

| # | Pin | Trust Boundary | Defense Present | Gap |
|---|-----|---------------|-----------------|-----|
| 1 | `filePath` in ImportJobPayload | Redis → Worker filesystem | `sanitizeFilename` at upload route | No re-validation at worker side |
| 2 | `sanitizeFilename` | User upload → filesystem | Strips `..`, directory components, unsafe chars | Defense is in import-engine, re-exported — single point |
| 3 | `startsWith(jobDir)` | Upload route path check | Validates path prefix | Only at web side, not worker |
| 4 | `REDIS_URL` | Network → queue control | Env var | If Redis compromised → attacker controls all job payloads |
| 5 | `DATABASE_URL` | Network → DB | Connection string | Worker has direct pool (max: 5), no row-level security |
| 6 | `JSON.stringify(properties)::jsonb` | Parsed file → raw SQL | None | No size/depth/key-count limit |
| 7 | `wkbHex` passthrough | GeoPackage file → PostGIS | `parseGpkgBlob` header check | No full WKB structural validation |
