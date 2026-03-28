# QA Waves + Seed Fixes Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire CI quality gates, fix 7 codebase-diagnostic bugs/issues (P1-P3), and clean up dead code.

**Architecture:** All changes are isolated to existing files — no new packages or architectural shifts. Bug fixes target specific functions. CI change is config-only. Cleanup tasks remove dead code and add a DB migration.

**Tech Stack:** SvelteKit 2, tRPC 11, Drizzle ORM, Vitest, GitHub Actions, PostGIS, BullMQ

---

## Execution Waves

- **Wave 1:** Task 1 (CI gate) — config only, no code deps
- **Wave 2:** Tasks 2, 3, 4, 5 (parallel bug fixes — independent subsystems)
- **Wave 3:** Tasks 6, 7 (parallel cleanup — independent subsystems)

---

### Task 1: CI Quality Gate

**Skill:** `none`
**Seed:** felt-like-it-233a

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add quality job before publish**

Add a `quality` job that runs lint, test, and check. Make `publish` depend on it.

```yaml
jobs:
  quality:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - run: pnpm run lint
      - run: pnpm run test
      - run: pnpm run check

  publish:
    needs: quality
    # ... existing publish job unchanged
```

- [ ] **Step 2: Verify YAML is valid**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"`
Expected: No error

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add test/lint/check quality gate before image push"
```

---

### Task 2: Worker Retry Cleanup Guard

**Skill:** `superpowers:test-driven-development`
**Seed:** felt-like-it-756a

**Files:**
- Modify: `services/worker/src/index.ts` (~line 115, before format dispatch)
- Reference: `apps/web/src/lib/server/geo/queries.ts` (getImportJobLayerId, deleteLayer)

The worker's catch block sets `status = 'failed'` but doesn't clean up partial layers. On BullMQ retry, it re-processes the file and creates duplicate layers. The web app's `import/index.ts` has `cleanupPreviousAttempt` but the worker doesn't call it.

- [ ] **Step 1: Write failing test**

Create `services/worker/src/__tests__/cleanup-guard.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

describe('worker cleanup on retry', () => {
  it('deletes partial layer from previous attempt before re-importing', async () => {
    // Test that getImportJobLayerId is called with the jobId
    // and deleteLayer is called if a layer exists
    // (Exact implementation depends on how worker exposes this —
    //  the executing agent should read worker/src/index.ts lines 100-130
    //  to understand the job processing entry point)
  });
});
```

- [ ] **Step 2: Add cleanup guard to worker job processor**

In `services/worker/src/index.ts`, at the start of the job processing function (before format dispatch), add:

```typescript
import { getImportJobLayerId, deleteLayer } from './queries.js';
// Or if queries are in the web app, import the SQL directly:
// Use db.execute(sql`SELECT layer_id FROM import_jobs WHERE id = ${jobId}`)

// At start of job processing, before parsing:
const existingLayerId = await getImportJobLayerId(jobId);
if (existingLayerId) {
  await deleteLayer(existingLayerId);
}
```

Note: The executing agent must check whether `getImportJobLayerId` and `deleteLayer` are available to the worker or need to be reimplemented with raw SQL (the worker uses raw SQL, not Drizzle). If raw SQL is needed:

```typescript
const [existing] = await pool.query(
  `SELECT layer_id FROM import_jobs WHERE id = $1 AND layer_id IS NOT NULL`,
  [jobId]
);
if (existing?.layer_id) {
  await pool.query(`DELETE FROM features WHERE layer_id = $1`, [existing.layer_id]);
  await pool.query(`DELETE FROM layers WHERE id = $1`, [existing.layer_id]);
}
```

- [ ] **Step 3: Run test**

Run: `cd services/worker && npx vitest run --reporter verbose`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add services/worker/src/
git commit -m "fix: add cleanup guard for worker retry — prevents duplicate layers"
```

---

### Task 3: Signup Email Race Condition

**Skill:** `superpowers:test-driven-development`
**Seed:** felt-like-it-ff50

**Files:**
- Modify: `apps/web/src/routes/auth/signup/+page.server.ts` (line ~55, the INSERT)

The SELECT-then-INSERT has a TOCTOU race. DB unique index catches it but surfaces as 500.

- [ ] **Step 1: Write failing test**

Add to `apps/web/src/__tests__/signup-race.test.ts`:

```typescript
// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';

describe('signup duplicate email handling', () => {
  it('returns friendly error when INSERT hits unique constraint', async () => {
    // Mock db.insert to throw a unique violation error
    // (error.code === '23505' for PostgreSQL unique_violation)
    // Verify the action returns fail(400) with 'email already exists' message
  });
});
```

- [ ] **Step 2: Wrap INSERT in try/catch**

In `+page.server.ts`, wrap the `db.insert(users)` call:

```typescript
let user;
try {
  [user] = await db
    .insert(users)
    .values({ email, hashedPassword, name })
    .returning({ id: users.id });
} catch (err: unknown) {
  // PostgreSQL unique_violation on email index
  if (err instanceof Error && 'code' in err && (err as { code: string }).code === '23505') {
    return fail(400, { field: 'email', message: 'An account with this email already exists.' });
  }
  throw err;
}
```

- [ ] **Step 3: Run tests**

Run: `cd apps/web && npx vitest run signup-race --reporter verbose`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/routes/auth/signup/+page.server.ts apps/web/src/__tests__/signup-race.test.ts
git commit -m "fix: handle signup email uniqueness race — friendly error instead of 500"
```

---

### Task 4: Geoprocessing SQL Timeout

**Skill:** `superpowers:test-driven-development`
**Seed:** felt-like-it-995b

**Files:**
- Modify: `apps/web/src/lib/server/geo/geoprocessing.ts` (add timeout before each operation)

- [ ] **Step 1: Write failing test**

Add timeout test to `apps/web/src/__tests__/geoprocessing.test.ts`:

```typescript
it('sets statement_timeout before executing operation', async () => {
  // After setting up mocks for a buffer operation,
  // verify db.execute was called with a SQL containing 'statement_timeout'
  // before the actual geoprocessing SQL
});
```

- [ ] **Step 2: Add timeout to runGeoprocessing**

At the top of the `runGeoprocessing` function, before the switch:

```typescript
export async function runGeoprocessing(op: GeoprocessingOp, newLayerId: string): Promise<void> {
  // Guard against unbounded PostGIS operations on large datasets
  await db.execute(sql`SET LOCAL statement_timeout = '30s'`);

  switch (op.type) {
    // ... existing cases unchanged
```

`SET LOCAL` scopes to the current transaction — safe for concurrent requests.

- [ ] **Step 3: Run tests**

Run: `cd apps/web && npx vitest run geoprocessing --reporter verbose`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/geo/geoprocessing.ts apps/web/src/__tests__/geoprocessing.test.ts
git commit -m "fix: add 30s statement_timeout on geoprocessing SQL operations"
```

---

### Task 5: Remove Dead Sync Import Path

**Skill:** `none`
**Seed:** felt-like-it-01a6

**Files:**
- Delete: `apps/web/src/lib/server/import/index.ts`

The `importFile()` function in this file is never called — the async BullMQ path handles all imports. BUT `cleanupPreviousAttempt` in this file is needed by Task 2 (worker cleanup). Since Task 2 reimplements the cleanup directly in the worker using raw SQL (worker doesn't use Drizzle), this file can be safely deleted.

- [ ] **Step 1: Verify no imports of this file exist**

Run: `grep -rn "from.*import/index" apps/web/src/ --include='*.ts' --include='*.svelte' | grep -v node_modules | grep -v __tests__`
Expected: No matches (or only re-exports that can be updated)

- [ ] **Step 2: Check if ImportResult type is re-exported**

The file has `export type { ImportResult } from './shared.js'`. If anything imports `ImportResult` from `./index.js`, update those imports to point to `./shared.js` directly.

- [ ] **Step 3: Delete the file**

```bash
rm apps/web/src/lib/server/import/index.ts
```

- [ ] **Step 4: Run lint and tests to verify nothing breaks**

Run: `cd apps/web && npx vitest run --reporter verbose && npx eslint src/`
Expected: All PASS

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/src/lib/server/import/
git commit -m "cleanup: remove dead sync import path (import/index.ts)"
```

---

### Task 6: Drop v1 Annotations Table + Dead Collaboration Stubs

**Skill:** `none`
**Seed:** felt-like-it-5f43

**Files:**
- Create: `apps/web/src/lib/server/db/migrations/NNNN_drop_v1_annotations.sql`
- Modify: `apps/web/src/lib/server/db/schema.ts` (remove lines 224-238, 421-422)
- Delete: `apps/web/src/lib/components/collaboration/ActivityFeed.svelte`
- Delete: `apps/web/src/lib/components/collaboration/ShareDialog.svelte`
- Delete: `apps/web/src/lib/components/collaboration/CommentPanel.svelte`
- Delete: `apps/web/src/lib/components/collaboration/CollaboratorsPanel.svelte`
- Delete: `apps/web/src/lib/components/collaboration/GuestCommentPanel.svelte`

- [ ] **Step 1: Verify v1 annotations table has no active consumers**

Run: `grep -rn "annotations\b" apps/web/src/ --include='*.ts' --include='*.svelte' | grep -v annotation_objects | grep -v annotation_changelog | grep -v __tests__ | grep -v schema.ts | grep -v '.d.ts'`
Expected: No matches referencing the v1 `annotations` table (as opposed to `annotation_objects`)

- [ ] **Step 2: Verify collaboration stubs have no imports**

Run: `grep -rn "from.*components/collaboration" apps/web/src/ --include='*.ts' --include='*.svelte' | grep -v node_modules`
Expected: No matches

- [ ] **Step 3: Create migration**

Find the next migration number, then create:

```sql
-- Drop the legacy v1 annotations table (replaced by annotation_objects)
DROP TABLE IF EXISTS annotations;
```

- [ ] **Step 4: Remove v1 from schema.ts**

Remove the `annotations` pgTable definition (lines ~224-238) and its type exports (lines ~421-422: `AnnotationRow`, `NewAnnotation`).

- [ ] **Step 5: Delete dead stubs**

```bash
rm -rf apps/web/src/lib/components/collaboration/
```

- [ ] **Step 6: Run lint and tests**

Run: `cd apps/web && npx vitest run --reporter verbose && npx eslint src/`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "cleanup: drop v1 annotations table + remove dead collaboration/ stubs"
```

---

### Task 7: Comment Pagination

**Skill:** `superpowers:test-driven-development`
**Seed:** felt-like-it-3a43

**Files:**
- Modify: `apps/web/src/lib/server/trpc/routers/comments.ts` (lines ~13 and ~113)
- Modify: `apps/web/src/__tests__/comments.test.ts`

Add cursor-based pagination to `comments.list` and `comments.listForShare`. Both currently return all rows.

- [ ] **Step 1: Write failing test**

Add to `apps/web/src/__tests__/comments.test.ts`:

```typescript
describe('comments.list pagination', () => {
  it('returns limited results with cursor when limit is provided', async () => {
    // Mock db.select to return 25 comments
    // Call list with { mapId, limit: 10 }
    // Expect result.items.length === 10
    // Expect result.nextCursor to be defined
  });

  it('returns all results when no limit is provided (backward compat)', async () => {
    // Call list with { mapId } (no limit)
    // Expect all results returned (existing behavior preserved)
  });
});
```

- [ ] **Step 2: Add optional pagination input**

In `comments.ts`, modify the input schema for `list` and `listForShare`:

```typescript
.input(z.object({
  mapId: z.string().uuid(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().uuid().optional(), // createdAt-based cursor via comment ID
}))
```

- [ ] **Step 3: Implement cursor pagination**

Modify the query to add `WHERE id < cursor ORDER BY createdAt DESC LIMIT limit+1`. Return `{ items, nextCursor }` when limit is provided, flat array when not (backward compat).

- [ ] **Step 4: Run tests**

Run: `cd apps/web && npx vitest run comments --reporter verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/trpc/routers/comments.ts apps/web/src/__tests__/comments.test.ts
git commit -m "feat: add cursor-based pagination to comment endpoints"
```

---

## Open Questions

### Wave 1
- **Task 1:** (none — fully specified)

### Wave 2
- **Task 2:** Does the worker have access to `getImportJobLayerId`/`deleteLayer` from the web app, or does it need raw SQL? (Blocking — check at execution time by reading worker imports)
- **Task 3:** (none — fully specified)
- **Task 4:** Does `SET LOCAL statement_timeout` require a transaction context in Drizzle? (Exploratory — test during implementation; if needed, wrap in `db.transaction()`)
- **Task 5:** Does anything import `ImportResult` from `import/index.ts`? (Blocking — verify with grep before deleting)

### Wave 3
- **Task 6:** What's the next migration number? (Blocking — check `apps/web/src/lib/server/db/migrations/` at execution time)
- **Task 7:** Does the frontend comment list component handle paginated responses, or does it expect a flat array? (Exploratory — backward compat approach avoids this by returning flat array when no limit)

---

<!-- PLAN_MANIFEST_START -->
| File | Action | Marker |
|------|--------|--------|
| `.github/workflows/ci.yml` | patch | `needs: quality` |
| `services/worker/src/index.ts` | patch | `cleanupPreviousAttempt` or `getImportJobLayerId` |
| `apps/web/src/routes/auth/signup/+page.server.ts` | patch | `23505` |
| `apps/web/src/lib/server/geo/geoprocessing.ts` | patch | `statement_timeout` |
| `apps/web/src/lib/server/import/index.ts` | delete | |
| `apps/web/src/lib/server/db/schema.ts` | patch | removal of `annotations` pgTable |
| `apps/web/src/lib/components/collaboration/` | delete | |
| `apps/web/src/lib/server/trpc/routers/comments.ts` | patch | `nextCursor` |
| `services/worker/src/__tests__/cleanup-guard.test.ts` | create | `cleanup-guard` |
| `apps/web/src/__tests__/signup-race.test.ts` | create | `signup-race` |
| `apps/web/src/__tests__/comments.test.ts` | patch | `pagination` |
| `apps/web/src/__tests__/geoprocessing.test.ts` | patch | `statement_timeout` |
<!-- PLAN_MANIFEST_END -->
