# Risk Map

Aggregated risk signals from all zoom levels, ordered by severity.
Each risk is characterized along 6 dimensions and assigned a gate tier.

**Dimension key:**
- **Spatial** — where in the codebase (subsystem, layer, file)
- **Temporal** — when it matters (build, deploy, runtime, scale)
- **Flow** — which data/control flows it disrupts
- **Tangle** — how many subsystems it couples (1=local, 3+=systemic)
- **Absorption** — how ready the system is to accept a fix (high=easy, low=hard)
- **Constraint** — what it blocks or unlocks (dependency ordering)

**Gate tiers:** Fatal (blocks all action) | Warning (flag, plan fix) | Info (note, fix opportunistically)

---

## Fatal Risk

None identified. The previously flagged disabled-user auth gap was **disproved** by deep drill:
`hooks.server.ts` checks `disabledAt` upstream and invalidates sessions; `admin.toggleDisabled`
calls `lucia.invalidateUserSessions()`. All REST v1 handlers call `resolveAuth()` (100% coverage).

---

## Warning Risk

### W1. Dockerfile Build Defect [Infrastructure, L3]
- **Signal:** `Dockerfile.web` and `Dockerfile.worker` don't COPY `packages/import-engine/package.json`. Docker builds will fail once import-engine is committed.
- **Spatial:** Infrastructure layer (`Dockerfile.web`, `Dockerfile.worker`)
- **Temporal:** Build-time. Blocks CI/CD immediately on merge.
- **Flow:** Build pipeline halts; no deploy possible.
- **Tangle:** 2 (web + worker Dockerfiles, import-engine package)
- **Absorption:** High. Surgical 2-line fix per Dockerfile.
- **Constraint:** **Gate-opener.** Blocks deployment of every other fix. Must be first.
- **Fix:** Add `COPY packages/import-engine/package.json ./packages/import-engine/` to both Dockerfiles before `pnpm install`.

### W2. Unvalidated filePath at Worker [Data-pipeline, L6, Security]
- **Signal:** Worker receives `filePath` from Redis queue without re-validation. Arbitrary file read if queue is compromised.
- **Spatial:** `services/worker/src/index.ts`, job handler
- **Temporal:** Runtime. Exploitable whenever queue accepts a job.
- **Flow:** Import pipeline: queue message -> file read -> parse -> DB insert. Poisoned path escapes import sandbox.
- **Tangle:** 2 (worker + Redis queue contract)
- **Absorption:** High. Path validation is a single guard at job entry.
- **Constraint:** Independent. No ordering dependency.
- **Fix:** Validate `filePath` starts with expected `UPLOAD_DIR` prefix and resolve symlinks before opening.

### W3. Unlimited JSONB Properties [Data-pipeline, L6, Security]
- **Signal:** Feature properties stored as unbounded JSONB. No size limit on import or API write.
- **Spatial:** Import pipeline (all format parsers) + feature mutation endpoints
- **Temporal:** Runtime. Grows with each import.
- **Flow:** Import/edit -> DB insert -> query -> render. Oversized properties degrade query and render perf.
- **Tangle:** 3 (import-engine, worker raw SQL, web ORM inserts)
- **Absorption:** Medium. Requires coordinated limit in import-engine + API validation + migration for existing data.
- **Constraint:** Easier after import-engine extraction consolidates the insertion points.
- **Fix:** Add property count limit (e.g., 100 keys) and total size limit (e.g., 64KB) at import-engine boundary. Add same check at feature mutation API.

### W4. 4 Endorheic Basins (Resource Leaks) [Data-pipeline, L8]
- **Signal:** Uploaded files never cleaned, BullMQ jobs accumulate, `import_jobs` rows have no TTL, orphaned partial layers on failed imports.
- **Spatial:** Worker completed/failed handlers, import_jobs table, upload directory, layers table
- **Temporal:** Runtime, degrades over weeks/months of operation.
- **Flow:** Import lifecycle: upload -> queue -> process -> cleanup (missing terminal step).
- **Tangle:** 4 (file system, BullMQ, import_jobs table, layers table)
- **Absorption:** Medium. Four independent cleanup mechanisms needed.
- **Constraint:** Independent but higher ROI after Dockerfile fix enables deployment.
- **Fix:** (a) File cleanup in worker completed/failed handlers. (b) BullMQ `removeOnComplete`/`removeOnFail` TTL. (c) `import_jobs` row TTL or periodic sweep. (d) Partial layer cleanup on failure (port `cleanupPreviousAttempt` from web).

### W5. Dual DB Insertion Path [Data-pipeline, L5]
- **Signal:** Worker uses raw SQL for bulk insert; web uses Drizzle ORM. Bug fixes must be applied in 2 places.
- **Spatial:** `services/worker/src/index.ts` (raw SQL) vs `apps/web/src/lib/server/import/` (Drizzle)
- **Temporal:** Development-time. Every schema change or bug fix has dual-apply risk.
- **Flow:** Both paths terminate at the same `features` table. Divergent validation/sanitization.
- **Tangle:** 3 (worker, web import, shared schema)
- **Absorption:** Low. Requires import-engine to own the single insertion path.
- **Constraint:** **Blocked by W1** (Dockerfile fix). Resolved by completing import-engine extraction.
- **Fix:** Consolidate insertion into import-engine with a single Drizzle-based path. Worker and web both call import-engine.

### W6. Version Drift [Ecosystem, L2]
- **Signal:** `shpjs` (^6.1.0 vs ^6.2.0) and `sql.js` (^1.12.0 vs ^1.14.0) between import-engine and consumers.
- **Spatial:** `packages/import-engine/package.json` vs `apps/web/package.json`, `services/worker/package.json`
- **Temporal:** Build-time. Causes non-deterministic behavior if different versions resolve.
- **Flow:** Import parsing. Different parser versions may produce different output for edge-case inputs.
- **Tangle:** 3 (import-engine, web, worker)
- **Absorption:** High. Pin versions in import-engine, remove from consumers.
- **Constraint:** Resolves naturally when orphaned deps (I7) are cleaned.
- **Fix:** Declare deps only in import-engine. Remove duplicates from web/worker. Use workspace protocol.

### W7. Zero Runtime Validation at Redis/BullMQ Boundary [shared-types, L6]
- **Signal:** `ImportJobPayload` crosses web→worker via Redis queue without Zod parse on the receiving end. A schema change silently produces runtime failures, exhausting all 3 retries before anyone notices.
- **Spatial:** `services/worker/src/index.ts` (job handler entry), shared-types payload definition
- **Temporal:** Runtime. Triggered by any schema evolution of ImportJobPayload.
- **Flow:** Web enqueues job → Redis → Worker deserializes → uses fields. Missing/changed field = silent crash.
- **Tangle:** 3 (web enqueue, shared-types schema, worker consume)
- **Absorption:** High. Single Zod `.parse()` at worker job entry point.
- **Constraint:** Independent. Pairs well with W2 (both are worker entry-point guards).
- **Fix:** Add `ImportJobPayloadSchema.parse(job.data)` at the top of the worker job handler. Fail fast with a descriptive error instead of silent runtime crash.

### W8. No Rate Limiting on Guest Comments [collaboration, L8]
- **Signal:** Comment creation endpoint is a `publicProcedure` with no rate-limiting middleware and no CAPTCHA. Abuse vector for spam or DoS.
- **Spatial:** tRPC collaboration router, comment creation procedure
- **Temporal:** Runtime. Exploitable immediately by unauthenticated clients.
- **Flow:** Public client → tRPC → DB insert. No throttle at any layer.
- **Tangle:** 2 (collaboration router, middleware layer)
- **Absorption:** High. Add rate-limit middleware to the procedure.
- **Constraint:** Independent. Should be addressed alongside M5 (rate limiting architecture).
- **Fix:** Add per-IP rate limiting middleware to comment creation. Consider CAPTCHA for unauthenticated users.

### W9. Dual Auth Redundancy [rest-api, L8]
- **Signal:** `hooks.server.ts` and REST v1 middleware both independently resolve API keys, causing 2x DB lookups per authenticated REST request.
- **Spatial:** `apps/web/src/hooks.server.ts`, REST v1 middleware
- **Temporal:** Runtime. Performance tax on every authenticated API request.
- **Flow:** Request → hooks.server.ts resolves auth → REST middleware resolves auth again → handler. Redundant DB round-trip.
- **Tangle:** 2 (hooks.server.ts, REST middleware)
- **Absorption:** Medium. Requires deciding which layer owns auth resolution and passing context downstream.
- **Constraint:** Independent. Pure performance fix.
- **Fix:** Resolve auth once in hooks.server.ts; pass resolved identity via `event.locals`. REST middleware reads from locals instead of re-resolving.

### W10. Import Worker: Zero Test Coverage [import-worker, L5]
- **Signal:** 431 LOC handling raw SQL, file I/O, and retry logic with 0 test files. High-risk code with no safety net.
- **Spatial:** `services/worker/src/index.ts`
- **Temporal:** Development-time. Every change is a blind edit.
- **Flow:** All import job processing. Bugs are caught only in production or manual testing.
- **Tangle:** 2 (worker logic, import-engine integration)
- **Absorption:** Medium. Requires test harness setup for worker (mock Redis, mock DB).
- **Constraint:** Blocked by W1 (Dockerfile fix) for integration tests. Unit tests can proceed independently.
- **Fix:** Add test suite: unit tests for job handler logic, integration tests for DB insertion paths. Priority: error handling and retry logic.

---

## Medium Risk

### M15. GeoJSON Cache Size-Unaware [rest-api, L8]
- **Signal:** GeoJSON cache has a 200-entry max but no per-entry size limit. A 50K-feature layer can consume tens of MB per cache entry, leading to unbounded memory growth.
- **Spatial:** REST API GeoJSON response caching layer
- **Temporal:** Runtime. Degrades with large-layer usage patterns.
- **Flow:** API request → cache miss → generate GeoJSON → cache (unbounded size) → serve.
- **Tangle:** 1 (REST API cache)
- **Absorption:** High. Add max byte-size per entry and/or total cache byte budget.
- **Constraint:** Independent.
- **Fix:** Add per-entry byte limit (e.g., 5MB) and total cache byte budget (e.g., 200MB). Evict oversized entries immediately; use LRU within budget.

### M16. File Upload Quotas Missing [rest-api, L8]
- **Signal:** REST API `POST /files` enforces 50MB per-file limit but has no per-user total quota, no DB tracking of cumulative usage, and no file cleanup mechanism.
- **Spatial:** REST API file upload endpoint, upload storage directory
- **Temporal:** Runtime. Storage grows unbounded per user over time.
- **Flow:** Upload → write to disk → no accounting → no cleanup. Disk fills.
- **Tangle:** 2 (REST API, file storage)
- **Absorption:** Medium. Needs DB tracking table, quota enforcement middleware, and cleanup job.
- **Constraint:** Related to W4 (endorheic basins — file cleanup).
- **Fix:** Track uploads per user in DB. Enforce cumulative quota at upload time. Add cleanup job for orphaned files.

### M17. Share Tokens Never Expire [collaboration, L6]
- **Signal:** Share tokens have no TTL. Revocation is manual-only. A leaked token grants access indefinitely.
- **Spatial:** Share token generation and validation logic
- **Temporal:** Runtime. Risk grows with each shared link.
- **Flow:** Generate token → store → validate on access. No expiry check.
- **Tangle:** 1 (collaboration/sharing subsystem)
- **Absorption:** Medium. Requires adding `expiresAt` column, migration, and validation check.
- **Constraint:** Independent.
- **Fix:** Add `expiresAt` to share tokens with configurable TTL. Default to 30 days. Validate expiry on every access.

### M18. Activity Feed Write-Only Dead End [collaboration, L5]
- **Signal:** `eventsRouter` and `map_events` table exist and accumulate data, but zero UI components consume the activity feed. Write-only dead end.
- **Spatial:** Backend: events router, `map_events` table. Frontend: no consumer.
- **Temporal:** Runtime. Table grows, storage consumed, no value delivered.
- **Flow:** Actions → write to map_events → (nothing reads). Dead-end accumulation.
- **Tangle:** 2 (events router, map_events table)
- **Absorption:** Medium. Either build the UI consumer or remove the write path.
- **Constraint:** Independent. Decision point: ship the feature or remove the dead code.
- **Fix:** Either (a) build ActivityFeed UI component to consume map_events, or (b) remove eventsRouter and map_events to stop accumulation. Decision needed.

### M19. Map Canvas: 35 Boundary Crossings [map-canvas, L6]
- **Signal:** Highest boundary-crossing count of any component. `hotOverlay` ownership is ambiguous between MapCanvas and MapEditor.
- **Spatial:** `apps/web/src/lib/components/map/MapCanvas.svelte`, MapEditor
- **Temporal:** Development-time. High coupling makes changes risky.
- **Flow:** MapCanvas ↔ MapEditor state exchanges across 35 boundaries. Ownership unclear.
- **Tangle:** 2 (MapCanvas, MapEditor/MapEditorState)
- **Absorption:** Low. Requires defining clear ownership boundaries and narrowing the interface.
- **Constraint:** Related to I9 (DataTable coupling) — same pattern of over-broad state access.
- **Fix:** Define explicit ownership for hotOverlay. Reduce boundary crossings by passing narrow interfaces instead of full state objects.

### M20. Worker Concurrency Risk [import-worker, L8]
- **Signal:** 3 concurrent import jobs share a `pg.Pool` of 5 connections. Heavy batch inserts from concurrent jobs can saturate the pool, causing connection starvation.
- **Spatial:** `services/worker/src/index.ts`, pg.Pool configuration
- **Temporal:** Runtime. Triggered under concurrent import load.
- **Flow:** Job 1 + Job 2 + Job 3 → all issue batch inserts → pool exhausted → timeouts.
- **Tangle:** 2 (worker concurrency config, pg.Pool sizing)
- **Absorption:** High. Increase pool size or decrease concurrency.
- **Constraint:** Independent.
- **Fix:** Either increase pool to `concurrency * 2 + 1` (7) or reduce concurrency to 2. Add connection acquisition timeout logging.

---

## Info Risk

### I7. 8 Orphaned Dependencies [Ecosystem, L2]
- **Signal:** web/worker still list deps now handled by import-engine (`shpjs`, `sql.js`, `jszip`, `@placemarkio/tokml`, etc.).
- **Spatial:** `apps/web/package.json`, `services/worker/package.json`
- **Temporal:** Build-time. Inflates install, confuses dep resolution.
- **Flow:** No runtime impact if import-engine versions are compatible.
- **Tangle:** 2 (web + worker package manifests)
- **Absorption:** High. Mechanical removal.
- **Constraint:** Should follow W6 version alignment.
- **Fix:** Remove orphaned deps from web/worker package.json files after verifying import-engine exports cover usage.

### I8. sanitize.ts Re-export Shim [Data-pipeline, L7]
- **Signal:** 1-line re-export residual from import-engine extraction.
- **Spatial:** `apps/web/src/lib/server/import/sanitize.ts`
- **Temporal:** Development-time. Confusion only.
- **Flow:** None. Transparent re-export.
- **Tangle:** 1
- **Absorption:** High. Delete file, update imports.
- **Constraint:** None.
- **Fix:** Inline the import at call sites or delete the shim.

### I9. DataTable Implicit Coupling [Map-editor, L6]
- **Signal:** `DataTable.svelte` calls `getMapEditorState()` for the full class when it only needs `selectFeature()` and `selectedFeatureId`.
- **Spatial:** `apps/web/src/lib/components/data/DataTable.svelte`
- **Temporal:** Development-time. Over-coupling increases change surface.
- **Flow:** DataTable -> MapEditorState (full class). Should be DataTable -> narrow interface.
- **Tangle:** 2 (DataTable, MapEditorState)
- **Absorption:** Medium. Requires defining a narrow interface or passing props.
- **Constraint:** None. Can be fixed independently.
- **Fix:** Pass only the needed methods/state as props or define a narrow `SelectionAPI` interface.

### I10. useKeyboardShortcuts Naming Vestige [Map-editor, L5]
- **Signal:** `selectionStore` field name persists in keyboard shortcuts composable despite store being replaced by MapEditorState.
- **Spatial:** `apps/web/src/lib/components/map/useKeyboardShortcuts.svelte.ts`
- **Temporal:** Development-time. Naming confusion.
- **Flow:** None. Functionally correct.
- **Tangle:** 1
- **Absorption:** High. Rename.
- **Constraint:** None.
- **Fix:** Rename `selectionStore` to `mapEditor` or `editorState`.

### I11. interaction-modes.test.ts Reimplements State Machine [Map-editor, L5]
- **Signal:** Test file reimplements interaction mode transitions instead of testing MapEditorState directly. Will drift as MapEditorState evolves.
- **Spatial:** `apps/web/src/__tests__/interaction-modes.test.ts`
- **Temporal:** Development-time. Tests pass but don't guard actual implementation.
- **Flow:** Test coverage gap widens with each MapEditorState change.
- **Tangle:** 1
- **Absorption:** Medium. Requires rewriting tests against MapEditorState API.
- **Constraint:** None. Independent.
- **Fix:** Rewrite tests to exercise MapEditorState directly rather than reimplementing transition logic.

### I12. queueMicrotask Workaround [Map-editor, L8]
- **Signal:** MapCanvas click handler uses `queueMicrotask` to avoid Svelte 5 reactivity depth limit.
- **Spatial:** `apps/web/src/lib/components/map/MapCanvas.svelte`
- **Temporal:** Runtime. Works but fragile if Svelte internals change.
- **Flow:** Click -> queueMicrotask -> state update. Breaks synchronous event assumption.
- **Tangle:** 1
- **Absorption:** Low. Svelte framework constraint; no clean alternative yet.
- **Constraint:** None. Monitor for Svelte 5 fixes.
- **Fix:** Track Svelte 5 issue tracker. Replace when framework provides clean solution.

### I13. Unsaved Style Revert on Error [Map-editor, L8]
- **Signal:** StylePanel has no revert-on-mutation-error. Pre-existing issue.
- **Spatial:** StylePanel component
- **Temporal:** Runtime. User sees optimistic update but no rollback on failure.
- **Flow:** Style edit -> mutation -> error -> stale optimistic state displayed.
- **Tangle:** 1
- **Absorption:** Medium. Needs onError handler with state rollback.
- **Constraint:** None.
- **Fix:** Add onError handler to revert optimistic style changes.

### I14. collaboration/ Directory Removed [Annotation-collab, L5]
- **Signal:** Dead stubs removed but functionality gap remains. No real-time collaboration exists.
- **Spatial:** Former `collaboration/` directory
- **Temporal:** Feature gap. No runtime impact.
- **Flow:** N/A. Feature does not exist.
- **Tangle:** 1
- **Absorption:** N/A. Greenfield work.
- **Constraint:** None for current system health.
- **Fix:** Tracked as future feature, not a defect.

### I15. KML/GPX Empty Array Asymmetry [import-engine, L6]
- **Signal:** KML/GPX parsers return an empty array without throwing when all Placemarks lack geometry. Other parsers (Shapefile, GeoPackage) throw on equivalent conditions. Inconsistent error contract.
- **Spatial:** `packages/import-engine/` KML/GPX parser modules
- **Temporal:** Runtime. Downstream code may not expect empty arrays from parsers.
- **Flow:** Parse file → all geometries missing → empty array returned (vs throw in other parsers).
- **Tangle:** 1 (import-engine internal)
- **Absorption:** High. Align behavior: throw or return empty consistently across all parsers.
- **Constraint:** None.
- **Fix:** Align all parsers to throw `ImportError` when input produces zero valid features. Document the contract.

### I16. 9 Deadwood Dependencies in Worker [import-worker, L7]
- **Signal:** Worker `package.json` retains 9 dependencies that are fossils from the pre-import-engine era. Inflates install, confuses audits.
- **Spatial:** `services/worker/package.json`
- **Temporal:** Build-time. No runtime impact if unused.
- **Flow:** Install → unused packages pulled → wasted time and disk.
- **Tangle:** 1
- **Absorption:** High. Mechanical removal after verifying no direct imports remain.
- **Constraint:** Should follow I7 (orphaned deps in web) for consistency.
- **Fix:** Audit worker imports, remove unused dependencies.

### I17. Duplicate Escape Handlers in DrawingToolbar [drawing-tools, L8]
- **Signal:** DrawingToolbar has two Escape key handlers: a `$effect` at line 271 and a `svelte:window` binding at line 347. Both fire on the same keypress. Confusing, potentially order-dependent.
- **Spatial:** `apps/web/src/lib/components/map/DrawingToolbar.svelte`
- **Temporal:** Runtime. Both handlers execute; behavior depends on registration order.
- **Flow:** Escape keypress → two handlers fire → redundant state transitions.
- **Tangle:** 1
- **Absorption:** High. Remove one handler.
- **Constraint:** None.
- **Fix:** Consolidate into a single Escape handler. Prefer the `svelte:window` binding for consistency with other key handlers.

### I18. Double removeFeatures in Error Path [drawing-tools, L8]
- **Signal:** Catch block in drawing completion calls `removeFeatures` twice. Second call is dead code operating on already-removed features.
- **Spatial:** `apps/web/src/lib/components/map/DrawingToolbar.svelte`, error handling path
- **Temporal:** Runtime. No functional impact (second call is a no-op) but misleading.
- **Flow:** Draw → error → removeFeatures() → removeFeatures() (dead).
- **Tangle:** 1
- **Absorption:** High. Delete one line.
- **Constraint:** None.
- **Fix:** Remove the duplicate `removeFeatures` call.

### I19. JSONB Annotation Backward Compatibility [shared-types, L6]
- **Signal:** Changing `AnchorSchema` or `AnnotationContentSchema` Zod variants could break reads of historical rows stored as JSONB. No schema versioning or migration strategy for in-row data.
- **Spatial:** shared-types Zod schemas, annotations table JSONB columns
- **Temporal:** Runtime. Triggered by any schema evolution.
- **Flow:** Write annotation (v1 schema) → evolve schema to v2 → read historical row → parse failure.
- **Tangle:** 2 (shared-types schemas, DB rows)
- **Absorption:** Low. Requires versioned parsing or migration tooling.
- **Constraint:** None immediate. Risk materializes on next schema change.
- **Fix:** Add schema version field to JSONB payloads. Implement versioned parsers that can read all historical formats. Alternatively, write a migration when schemas change.

### I20. Rate Limit Counter Memory Leak [rest-api, L8]
- **Signal:** In-memory `Map<string, {count, resetAt}>` for rate limiting grows unbounded. Entries are never pruned for IPs that stop making requests.
- **Spatial:** REST API rate-limiting middleware
- **Temporal:** Runtime. Memory grows linearly with unique client IPs over time.
- **Flow:** Request → check/increment IP entry → entry persists forever.
- **Tangle:** 1
- **Absorption:** High. Add periodic sweep or use a time-windowed data structure.
- **Constraint:** Related to M5 (rate limiting architecture). Fix together.
- **Fix:** Add periodic cleanup (e.g., every 60s, prune entries past `resetAt`). Or replace with sliding-window counter using `setInterval` cleanup.

---

## Recommended Fix Ordering

Constraint-ordered sequence. Each tier unlocks the next. Items marked with `[NEW]` were added from Phase 2 drills.

```
 Priority  Risk   What                                Unlocks
 --------  -----  ----------------------------------  ---------------------------
 P0        W1     Dockerfile COPY fix                 Deployment of everything
 P1        W2     Worker filePath validation           Security baseline
 P1        W7     Redis/BullMQ payload validation [NEW] Schema-change safety
 P1        W8     Guest comment rate limiting [NEW]    Abuse prevention
 P1        W6     Version drift alignment              Clean dep tree
 P2        I7     Orphaned dep removal                 Smaller install, no confusion
 P2        I8     sanitize.ts shim removal             Cleaner import paths
 P2        I10    selectionStore rename                Naming clarity
 P2        I16    Worker deadwood deps [NEW]           Clean worker manifest
 P2        I20    Rate limit counter cleanup [NEW]     Fixes M5 memory leak
 P3        W5     Dual insertion path consolidation    Single bug-fix surface
 P3        W3     JSONB property limits                Security + perf baseline
 P3        W9     Dual auth redundancy [NEW]           Halve auth DB lookups
 P3        W10    Import worker test suite [NEW]       Safety net for worker changes
 P4        W4     Endorheic basin cleanup (4 items)    Operational stability
 P4        M16    File upload quotas [NEW]             Storage budget enforcement
 P4        M17    Share token expiry [NEW]             Credential hygiene
 P4        M20    Worker pool sizing [NEW]             Concurrency stability
 P5        M15    GeoJSON cache size limit [NEW]       Bounded memory usage
 P5        M18    Activity feed: ship or remove [NEW]  Eliminate dead-end writes
 P5        M19    MapCanvas boundary reduction [NEW]   Reduced coupling
 P5        I9     DataTable narrow interface            Reduced coupling
 P5        I11    Test rewrite against MapEditorState   Accurate test coverage
 P5        I13    StylePanel error revert               UX correctness
 P5        I15    KML/GPX error contract [NEW]          Parser consistency
 P5        I17    Duplicate Escape handler [NEW]        Code clarity
 P5        I18    Double removeFeatures [NEW]           Dead code removal
 --        I12    queueMicrotask                       Monitor only (framework)
 --        I14    collaboration/ gap                    Future feature (not a fix)
 --        I19    JSONB annotation compat [NEW]         Monitor until schema change
```

**Rationale:**
- **P0 (W1)** is the single gate-opener: nothing deploys until Dockerfiles are fixed.
- **P1 (W2, W7, W8, W6)** are high-absorption security/hygiene fixes with no dependencies. W7 and W8 are new: the Redis boundary validation is a one-line Zod parse that prevents silent runtime failures, and guest comment rate limiting closes an active abuse vector.
- **P2 (I7, I8, I10, I16, I20)** are mechanical cleanups that reduce noise for subsequent work. I16 (worker deadwood) and I20 (rate limit leak) are quick wins from the Phase 2 drills.
- **P3 (W5, W3, W9, W10)** are architectural fixes that require import-engine to be deployable (depends on P0) and benefit from clean deps (P2). W9 (dual auth) is a performance fix best done when the auth layer is being touched. W10 (worker tests) provides the safety net needed before deeper worker changes in P4.
- **P4 (W4, M16, M17, M20)** are operational stability fixes. Resource leaks (W4), storage quotas (M16), token expiry (M17), and pool sizing (M20) all protect against degradation under sustained use. Best done after W10 provides worker test coverage.
- **P5** are independent quality improvements with no ordering constraints. New entries from Phase 2 include cache limits, activity feed decision, MapCanvas coupling, parser consistency, and minor code cleanup.

---

## Risk by Subsystem (Updated after Phase 2 Drills)

```
  Subsystem          | Fatal | Warning | Medium | Info | Total
  -------------------+-------+---------+--------+------+------
  Infrastructure     |   -   |    1    |    -   |   -  |   1
  Data Pipeline      |   -   |    5    |    1   |   1  |   7
  Import Worker      |   -   |    2    |    1   |   1  |   4
  Shared Types       |   -   |    1    |    -   |   1  |   2
  Map Editor         |   -   |    -    |    1   |   5  |   6
  Drawing Tools      |   -   |    -    |    -   |   2  |   2
  REST API           |   -   |    1    |    2   |   1  |   4
  Collaboration      |   -   |    1    |    2   |   1  |   4
  Ecosystem          |   -   |    1    |    -   |   1  |   2
  Import Engine      |   -   |    -    |    -   |   1  |   1
```

**Phase 2 delta:** +4 Warning, +6 Medium, +6 Info = 16 new risk signals. No new Fatals.

## Previously Identified Risks (from earlier audits)

The following risks from prior audits remain valid and are tracked separately.
They are not duplicated above to avoid double-counting.

| ID | Risk | Tier | Status |
|----|------|------|--------|
| H1 | CI pipeline has no quality gate | High | Open |
| H3 | MapEditor god component (930 LOC) | High | Partially addressed (MapEditorState extracted) |
| M5 | Rate limiting (in-memory, single-process) | Medium | Open — see also W8 (guest comments), I20 (memory leak) |
| M8 | hotOverlay not cleaned on failure | Medium | Open — see also M19 (boundary crossings) |
| M9 | Annotation v1/v2 coexistence | Medium | Open |
| M10 | Feature properties stored raw (XSS) | Medium | Subsumed by W3 |
| M11 | Worker retry creates duplicate layers | Medium | Subsumed by W4d |
| M12 | No timeout on geoprocessing SQL | Medium | Open |
| M13 | Dead sync import path | Medium | Open |
| L14 | No real-time collaboration | Low | Subsumed by I14 |
| L15 | Export loads full dataset into memory | Low | Open |
| L16 | Dead collaboration components | Low | Resolved (removed) |
| L17 | Empty geoprocessing creates silent layers | Low | Open |
| L18 | API keys: no per-map scoping | Low | Open |

**See also:** [cross-cutting/security](cross-cutting/security.md) | [overview](overview.md)
