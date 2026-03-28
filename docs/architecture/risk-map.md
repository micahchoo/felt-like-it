# Risk Map

Aggregated risk signals from all zoom levels, ordered by severity.

## Critical Risk

None. The initially flagged disabled-user auth gap was **disproved** by deep drill:
`hooks.server.ts` checks `disabledAt` upstream and invalidates sessions; `admin.toggleDisabled`
calls `lucia.invalidateUserSessions()`. All REST v1 handlers call `resolveAuth()` (100% coverage).

## High Risk

### 1. CI Pipeline Has No Quality Gate (Infrastructure)
- `.github/workflows/ci.yml` only builds + pushes images
- 73 test files, ESLint, svelte-check — none enforced
- **Impact:** Broken imports, type errors, regressions ship to production
- **Fix:** Add test/lint/check steps before image build

### 3. MapEditor God Component (Map Editor)
- 930 LOC orchestrating 10+ subsystems, 62 commits (hottest file)
- 42 imports, 21 $state, 14 $effect, 15 handlers, 18 child components
- No component-level tests
- **Impact:** Any map-related change touches this file. Untestable composition layer.
- **Decomposition seams identified:** StatusBar, DialogVisibility, LayerDataManager, InteractionModeBridge, KeyboardShortcuts, ViewportSave (see subsystems/map-editor/)
- **Fix:** Extract composables in order: StatusBar → Dialogs → LayerDataManager → InteractionBridge → KeyboardShortcuts

### 4. Import Worker Has No Tests (Data Pipeline)
- 669 LOC with raw SQL bulk insert bypassing ORM
- Duplicates all format parsers from web app
- **Impact:** Data corruption risk, dual-maintenance burden
- **Fix:** Extract shared import-engine package; add worker tests

### 5. No File Cleanup After Import (Data Pipeline)
- Uploaded files persist in UPLOAD_DIR indefinitely
- **Impact:** Disk exhaustion on self-hosted deployments
- **Fix:** Add cleanup in worker completed/failed handlers or scheduled sweep

## Medium Risk

### 5. Rate Limiting (Auth/API)
- In-memory counter, resets on restart, single-process only
- tRPC public procedures (comments.listForShare, createForShare) have no rate limiting
- **Impact:** API abuse, DoS on auth endpoints and public comment endpoints
- **Fix:** Redis-backed rate limiter; add tRPC rate limiting middleware for public procedures

### 7. Dual Interaction State (Map Editor)
- `mapStore.InteractionMode` (legacy) coexists with `interactionModes.InteractionState`
- Unclear if legacy is consumed
- **Impact:** State divergence, naming confusion
- **Fix:** Audit usages, remove redundant type

### 8. hotOverlay Not Cleaned on Failure (Map Editor)
- DrawingToolbar's featureUpsertMutation has no onError cleanup
- **Impact:** Ghost features visible with no server backing
- **Fix:** Add onError handler to remove hotOverlay entry

### 9. Annotation v1/v2 Coexistence (Annotations)
- v1 `annotations` table has no active write paths
- v2 `annotation_objects` is the live table
- **Impact:** Schema confusion, dead table maintenance
- **Fix:** Migration to drop v1 + schema cleanup

### 10. Feature Properties Stored Raw (Data Pipeline)
- No server-side sanitization of imported data
- **Impact:** Stored XSS if frontend renders as HTML
- **Fix:** Audit frontend rendering; add sanitization or CSP

### 11. Worker Retry Creates Duplicate Layers (Data Pipeline)
- Worker lacks `cleanupPreviousAttempt` guard that web import has
- BullMQ retries (3 attempts) re-process same file without cleaning partial layer
- **Impact:** Duplicate layers on retry after partial insert
- **Fix:** Port `cleanupPreviousAttempt` to worker error handling

### 12. No Timeout on Geoprocessing SQL (Geoprocessing)
- All 10 PostGIS operations run synchronously with no statement_timeout
- **Impact:** Large dataset buffer/union could hang web process indefinitely
- **Fix:** Add `SET LOCAL statement_timeout` per geoprocessing query

### 13. Dead Sync Import Path (Data Pipeline)
- `import/index.ts → importFile()` is dead code — never called
- **Impact:** Maintenance confusion, false test coverage signal
- **Fix:** Remove or verify it's genuinely unused

## Low Risk

### 14. No Real-Time Collaboration
- ActivityFeed: poll-on-trigger only; no SSE/WebSocket
- Comments: manual invalidation
- **Impact:** Collaborators don't see each other's activity live

### 15. Export Loads Full Dataset into Memory
- No streaming for GeoJSON/Shapefile export
- **Impact:** OOM on large layers

### 16. Dead Collaboration Components
- `collaboration/` directory contains 5 unused stub duplicates of active `map/` components
- **Impact:** Confusion, potential wrong-import bugs

### 17. Empty Geoprocessing Results Create Silent Empty Layers
- Operations producing zero features still create a new layer with no user warning
- **Impact:** Confusing empty layers accumulate

### 18. API Keys: No Per-Map Scoping
- Single API key grants access to ALL user's maps
- **Impact:** Over-broad access for integrations

## Risk by Subsystem

```
  Subsystem          │ Crit │ High │ Med │ Low │
  ───────────────────┼──────┼──────┼─────┼─────┤
  Auth / Session     │  -   │  -   │  2  │  2  │
  Map Editor         │  -   │  1   │  2  │  -  │
  Data Pipeline      │  -   │  2   │  3  │  2  │
  Infrastructure     │  -   │  1   │  -  │  -  │
  Annotations        │  -   │  -   │  1  │  1  │
  Collaboration      │  -   │  -   │  -  │  2  │
  Geoprocessing      │  -   │  -   │  1  │  1  │
```

**See also:** [cross-cutting/security](cross-cutting/security.md) | [overview](overview.md)
