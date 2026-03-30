# Evaluation: Lightweight DB Integration Test Layer

**Date:** 2026-03-29
**Seed:** felt-like-it-d671
**Status:** Evaluation (no implementation)

## Current State

### Mocking Pattern

Every server-side test file manually mocks `$lib/server/db/index.js` via `vi.mock()`, replacing the Drizzle `db` object with stub methods (`select`, `insert`, `update`, `delete`, `execute`). A shared `drizzleChain()` helper in `test-utils.ts` builds a fluent chain mock (`.from().where().orderBy()...`) that resolves to a canned value.

**Files using this pattern:** 20+ test files across `apps/web/src/__tests__/` (maps, features, audit-log, collaborators, import-*, comments, admin, rate-limit, events, etc.)

### What's Mocked Away

- **Drizzle query builder** -- chain methods (`from`, `where`, `set`, `orderBy`, `innerJoin`, `leftJoin`, `limit`, `offset`) are all `vi.fn(() => chain)`. Tests never verify that the correct `.where()` clause is built.
- **Raw SQL via `db.execute()`** -- geo queries (`queries.ts`) use raw `sql` template literals with PostGIS functions. Tests mock `db.execute` to return canned rows; the SQL is never parsed or evaluated.
- **`$lib/server/geo/queries.js`** -- `insertFeatures`, `getLayerBbox`, etc. are mocked entirely in import tests. The actual PostGIS SQL (`ST_AsGeoJSON`, `ST_GeomFromGeoJSON`, `ST_Extent`, `ST_Transform`, `ST_GeomFromWKB`) is never executed.

### What's at Risk

1. **SQL correctness** -- raw SQL strings in `queries.ts` (7 functions, all PostGIS-dependent) are completely untested against a real parser. A typo in `ST_AsGeoJSON(geometry)::json` would pass all tests.
2. **Schema drift** -- column names in raw SQL (`layer_id`, `created_at`) must match the actual schema. Mocks don't catch mismatches after a migration.
3. **Drizzle query builder semantics** -- the chain mock doesn't validate argument types or method ordering. A test passes with `db.select().from(features).where(eq(features.id, 42))` even if `eq()` is called with wrong column references.
4. **Transaction correctness** -- `db.transaction()` is mocked as `vi.fn()` in collaborators tests. Rollback/commit behavior is untested.
5. **Geoprocessing operations** -- `geoprocessing.ts` and `access.ts` contain spatial queries (nearest-neighbor joins, bbox calculations, permission checks by map ownership) that depend on PostGIS operators (`<->` KNN).

## Option Comparison

### Option 1: pg-mem (in-memory PostgreSQL)

| Aspect | Assessment |
|--------|------------|
| **Speed** | Fast (~50ms startup). No external process. |
| **PostGIS support** | None. pg-mem does not support PostGIS extension, custom types, or spatial functions (`ST_*`). This is a hard blocker for this project -- 7/7 functions in `queries.ts` use PostGIS. |
| **Drizzle support** | Partial. Works for basic ORM queries; raw `sql` template literals may hit edge cases. |
| **CI impact** | None -- runs in-process. |
| **Verdict** | **Eliminated.** PostGIS dependency makes pg-mem unusable for the queries that matter most. Could only cover non-spatial Drizzle ORM queries (CRUD on maps, layers, users), which are already low-risk due to Drizzle's type safety. |

### Option 2: testcontainers-node (real PostgreSQL + PostGIS in Docker)

| Aspect | Assessment |
|--------|------------|
| **Speed** | ~3-5s cold start (first test suite), reusable across test files via `globalSetup`. Subsequent suites connect to the running container. |
| **PostGIS support** | Full. Uses `postgis/postgis:16-3.4` image. All `ST_*` functions, `<->` KNN operator, `geometry` columns work. |
| **Drizzle support** | Full. Real `pg.Pool` connection; no behavioral differences from production. |
| **CI impact** | Requires Docker in CI. GitHub Actions `ubuntu-latest` has Docker pre-installed. Add `services:` block or let testcontainers manage it. |
| **Migration support** | Can run real Drizzle migrations against the container. Catches schema drift automatically. |
| **Isolation** | Per-suite or per-test isolation via `TRUNCATE` or transaction rollback. |
| **Verdict** | **Best fit.** Only option that tests the actual PostGIS SQL paths. Docker overhead is acceptable with container reuse. |

### Option 3: Drizzle Test Transactions (rollback wrapping)

| Aspect | Assessment |
|--------|------------|
| **Speed** | Near-zero overhead per test (BEGIN/ROLLBACK). Requires a running PostgreSQL+PostGIS instance. |
| **PostGIS support** | Full (same as production DB). |
| **Drizzle support** | Full, but requires wrapping every test in `db.transaction()` and aborting it. Drizzle's transaction API supports this. |
| **CI impact** | Needs a PostgreSQL service in CI (via `services:` in GHA, or testcontainers for setup). Cannot run standalone. |
| **Isolation** | Excellent per-test isolation via rollback. No cleanup needed. |
| **Dev experience** | Requires a local PostgreSQL+PostGIS instance running. Adds friction for contributors. |
| **Verdict** | **Good complement to Option 2.** Use testcontainers to start the DB, then wrap individual tests in rollback transactions for speed + isolation. |

## Recommendation

**Use testcontainers-node with transaction-per-test isolation (Options 2 + 3 combined).**

### Architecture

```
vitest globalSetup
    |
    v
testcontainers starts postgis/postgis:16-3.4
    |
    v
run Drizzle migrations (drizzle-kit push or migrate)
    |
    v
export DATABASE_URL to test env
    |
    v
each test file:
    beforeEach: BEGIN transaction, inject tx-scoped db
    afterEach:  ROLLBACK
    |
    v
globalTeardown: stop container
```

### Rationale

1. **PostGIS is non-negotiable** -- the highest-risk untested code is all raw PostGIS SQL. pg-mem cannot cover it.
2. **testcontainers eliminates "works on my machine"** -- no local PostgreSQL setup required. Docker is already available in CI.
3. **Transaction rollback gives per-test isolation** without `TRUNCATE` overhead. Tests stay fast after the one-time container startup.
4. **Schema drift detection** -- running real migrations against the test DB catches column renames, type changes, and constraint additions before they hit production.
5. **Incremental adoption** -- integration tests live alongside existing unit tests. No need to migrate existing mock-based tests; add integration tests for high-risk queries only.

### Dependencies to Add

```json
{
  "devDependencies": {
    "testcontainers": "^10.7.0",
    "@testcontainers/postgresql": "^10.7.0"
  }
}
```

## Suggested Starting Scope

Test these 5 functions first -- they contain the raw PostGIS SQL that mocks completely skip:

| # | Function | File | PostGIS Functions Used | Risk |
|---|----------|------|----------------------|------|
| 1 | `insertFeatures` | `geo/queries.ts:51` | `ST_GeomFromGeoJSON` | Bulk insert; a SQL error loses an entire import |
| 2 | `getLayerBbox` | `geo/queries.ts:75` | `ST_Extent`, `ST_XMin/YMin/XMax/YMax` | Powers map viewport; wrong bbox breaks UX |
| 3 | `getLayerFeatures` | `geo/queries.ts:31` | `ST_AsGeoJSON` | GeoJSON export path; casting errors corrupt output |
| 4 | `insertWkbFeatures` | `geo/queries.ts:150` | `ST_GeomFromWKB`, `ST_Transform` | GeoPackage import; CRS reprojection is complex |
| 5 | `countLayerFeatures` | `geo/queries.ts:112` | (none, but raw SQL) | Simple but validates schema column naming |

### Test Shape (pseudocode)

```typescript
// integration/geo-queries.integration.test.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer;
let db: Database;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgis/postgis:16-3.4').start();
  // connect drizzle, run migrations
}, 30_000);

afterAll(async () => {
  await container.stop();
});

// Each test uses a real DB with real PostGIS
it('insertFeatures + getLayerFeatures round-trips GeoJSON', async () => {
  // insert 3 points via insertFeatures
  // read back via getLayerFeatures
  // assert geometry round-trips correctly
});

it('getLayerBbox returns correct extent', async () => {
  // insert features at known coordinates
  // assert bbox matches expected [minLng, minLat, maxLng, maxLat]
});

it('insertWkbFeatures reprojects non-4326 SRID', async () => {
  // insert WKB with SRID 3857
  // read back and verify coordinates are in 4326
});
```

## Non-Goals

- **Not replacing existing mock tests.** The 20+ mock-based test files validate business logic (routing, error handling, batching). They stay.
- **Not testing Drizzle ORM queries.** Drizzle's type system already catches most column/table reference errors at compile time. Focus integration tests on raw SQL only.
- **Not E2E.** This layer sits between unit tests and Playwright E2E. It tests the DB boundary, not HTTP endpoints.
