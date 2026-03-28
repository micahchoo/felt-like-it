# QA Assessment: felt-like-it

**Date:** 2026-03-28 | **Mode:** Evaluate + Brownfield Design | **Scope:** Full monorepo

## Stack Profile

| Layer | Technology |
|-------|-----------|
| Language | TypeScript + Svelte 5 (runes) |
| Framework | SvelteKit 2, Turborepo monorepo |
| Test Runner | Vitest (node environment, Drizzle mock chain pattern) |
| Linter | ESLint flat config × 2 (root: type-aware; web: syntax-only + Svelte) |
| Formatter | Prettier + EditorConfig |
| Dead Code | knip configured |
| CI | GitHub Actions — build+push only, **no quality gates** |
| Pre-commit | None |

## Hotspot Map

| Hotspot | 6mo Churn | Test Coverage | Status |
|---------|-----------|--------------|--------|
| MapEditor.svelte | 62 commits | interaction-modes.test.ts (extracted state machine) | **Partial** — orchestration untested |
| AnnotationPanel.svelte | 40 | annotation-service, annotation-objects, annotation-changelog, annotation-geo, annotation-create-anchors | **Well-defended** |
| MapCanvas.svelte | 25 | None | **RISK ZONE** |
| DrawingToolbar.svelte | 25 | drawing-store.test.ts | **Partial** — store tested, component not |
| LayerPanel.svelte | 11 | layers.test.ts | **Partial** — tRPC layer tested |
| schema.ts | 11 | shared-types/schemas.test.ts | **Well-defended** |
| Worker (index.ts) | N/A | None | **RISK ZONE** — 669 LOC, raw SQL, 0 tests |

## Test Quality Audit (Phase 1)

**Sample:** 12 files (11 test files + shared test-utils), covering hotspots, seams, and critical paths.

### Classification Results

| Classification | Count | Percentage |
|---|---|---|
| **Purposeful** | 11/11 | 100% |
| Trivial | 0 | 0% |
| Fragile | 0 | 0% |
| Orphaned | 0 | 0% |
| Missing-the-point | 0 | 0% |

**This is a remarkably strong test suite.** Every sampled test targets real behavioral invariants, not implementation details.

### Standout Tests

- **interaction-modes.test.ts** (810 LOC) — Gold standard. Extracts pure state machine from MapEditor, stress-tests mode exclusivity, abandon flows, rapid switching, adversarial sequences. Tests discriminated union transitions without DOM or Svelte runtime.
- **maps.test.ts** (540 LOC) — Tests full tRPC CRUD + optimistic concurrency (version conflict → CONFLICT error) + access control.
- **audit-log.test.ts** — Tests SHA-256 hash chain integrity and tamper detection. Correctly tests the cryptographic invariant.
- **undo-store.test.ts** — Tests MAX_HISTORY (50) overflow, sequential undo via explicit loop, empty stack behavior.

### Test Conventions (team contracts via code)

- **Stub check enforced:** Tests use `drizzleChain<T>()` returning typed union arrays — trivial stubs fail because router code destructures results. (Convention: mx-68c9a5)
- **No magic literals:** UUID constants are deterministic (`aaaaaaaa-0000-...`) but assertions check relationships, not values.
- **Adversarial cases present:** Every test file includes at least one edge case (empty result, version conflict, unauthorized access, concurrent operations).
- **Names are specs:** `'throws CONFLICT when version does not match'`, `'rejects geoprocessing for non-editor'` — self-documenting.
- **Environment declared:** Every test file has `// @vitest-environment node` header (argon2 native bindings requirement).

### Mock Pattern

Consistent `vi.mock() → drizzleChain()` pattern for all server tests:
```
vi.mock('$lib/server/db/index.js') → import { db } → vi.mocked(db.select).mockReturnValueOnce(drizzleChain([...]))
```
Shared `test-utils.ts` exports `drizzleChain<T>()` (typed union return) and `mockContext()` (tRPC context factory). Mocks are at the **correct boundary** — they mock the DB layer, not internal functions. Store tests mock native bindings (terra-draw) — also correct.

## Linter & Formatter Audit (Phase 2)

### ESLint: Highly Customized (Architectural)

**Root config** (packages + services): Type-aware rules with `project: true`.
- `no-floating-promises: error` — catches unhandled async
- `prefer-nullish-coalescing: error` — enforces modern nullish handling

**Web config** (apps/web): Syntax-only (no `project`) to avoid .svelte-kit OOM.
- **Import boundary rules** (4 architectural rules):
  - Components cannot import server modules
  - Stores cannot import server modules or components
  - Server cannot import client components or stores
  - Public routes cannot import auth utilities
- `svelte/require-each-key: error` — reactive rendering correctness
- Separate parser configs for `.ts`, `.svelte.ts`, and `.svelte` files with correct globals

**Assessment:** These are **genuine architectural enforcement rules**, not just style. The import boundary rules are the most valuable lint rules in the project — they prevent the most dangerous category of bug (server code leaking to client, client code importing server secrets).

### Lint Suppressions: Strategic

| Category | Count | Pattern |
|---|---|---|
| `no-await-in-loop` | 8 | All documented: "sequential batches: progress tracking requires ordered completion" |
| `TYPE_DEBT` | 6 | All documented: Drizzle inference, Terra Draw types, lucide-svelte types, vi.fn() generics |
| `@ts-expect-error` | 1 | Intentional: runtime validation test with bad input |
| `.svelte-kit/types` `@ts-ignore` | ~20 | Generated code — not team-authored |

**Assessment:** Zero spray-and-pray. Every suppression has a rationale. The `TYPE_DEBT` convention is a project-specific pattern for tracking known type gaps — more disciplined than most codebases.

### Formatter: Complete Coverage

Prettier configured with `singleQuote`, `useTabs: true`, `printWidth: 100`. Covers `**/*.{js,ts,svelte,json,css,md}`. EditorConfig aligns. **No ambiguity in formatting.**

## Force Cluster Identification (Phase 3)

### FC1: State Machine Correctness vs Legacy Coexistence

**Tension:** Discriminated union `InteractionState` (new, 810 LOC test) coexists with `mapStore.InteractionMode` (legacy enum). Both model the same concept.

**Evidence:** interaction-modes.test.ts enforces the new model rigorously. No tests enforce the legacy model. The legacy type is still exported from mapStore.

**Resolution status:** Partially resolved — new model is enforced, old model is not yet removed. Import boundary rules don't catch this because both are in `stores/`.

### FC2: Type Safety vs Library Ergonomics

**Tension:** `no-explicit-any: error` globally, but 6 `TYPE_DEBT` markers where libraries produce inadequate types.

**Evidence:** Team chose documented escape hatches over rule relaxation. Each TYPE_DEBT has a specific reason.

**Resolution status:** Stable tension — TYPE_DEBT markers track the debt, knip prevents dead-code accumulation. No action needed unless TYPE_DEBT count grows.

### FC3: Sequential Processing vs Parallelism Rules

**Tension:** `no-await-in-loop: error` conflicts with intentional sequential batch processing for progress tracking.

**Evidence:** 8 suppressions, all documented, all in import pipeline (web + worker + geo-engine).

**Resolution status:** Fully resolved via documented suppressions. The rule catches genuine mistakes while allowing known exceptions.

### FC4: Local Quality Investment vs CI Enforcement Gap

**Tension:** 73 test files, ESLint with architectural rules, Prettier, knip — but CI only builds Docker images. `npm run test`, `npm run lint`, `npm run check` exist but aren't wired into CI.

**Evidence:** CI workflow has zero quality steps. All enforcement is developer-voluntary.

**Resolution status:** **UNRESOLVED.** This is the single biggest quality gap. Every regression shipped to production bypassed working quality tools.

## Contract Extraction (Phase 4)

### Load-Bearing (tested + linted + enforced)

- **Access control** — `requireMapAccess()` tested in geo-access.test.ts, enforced by tRPC protectedProcedure.
- **Discriminated union state machine** — interaction-modes.test.ts validates mode exclusivity. Team treats this as a structural invariant.
- **Import boundaries** — ESLint rules prevent components↔server imports. Architectural.
- **Type safety** — `no-explicit-any: error` + `TYPE_DEBT` convention. Team treats type holes as tracked debt.
- **Hash chain audit log** — audit-log.test.ts verifies cryptographic invariant.
- **Optimistic concurrency** — maps.test.ts tests version conflict handling. Data integrity invariant.

### Unguarded (no tests, no enforcement)

- **Worker import processing** — 669 LOC, raw SQL, bypasses Drizzle validation, zero tests.
- **MapCanvas rendering** — 25 commits of churn, no tests of any kind.
- **Component orchestration** — MapEditor's 14 $effect blocks are untested as a composition layer.
- **Geoprocessing SQL execution** — Router is tested, but actual PostGIS SQL (runGeoprocessing) is mocked. No integration test.
- **File upload cleanup** — No tests for cleanup lifecycle. Known disk exhaustion risk.
- **CI pipeline** — No quality gates. Regressions can ship.

### Conflicted (some enforcement, inconsistent)

- **Dual caching strategy** — DrawingToolbar uses TanStack query invalidation, MapEditor uses direct tRPC calls. Both work but via fragile coupling.
- **Annotation v1/v2** — v2 tested, v1 table still in schema with no tests and no cleanup migration.

---

## For characterization-testing

Priority characterization targets (untested seams):
1. **Worker import processing** — `services/worker/src/index.ts` — 669 LOC, 6 format parsers, raw SQL. Highest risk untested code.
2. **MapCanvas rendering lifecycle** — `apps/web/src/lib/components/map/MapCanvas.svelte` — map initialization, layer rendering, source management.
3. **Geoprocessing SQL** — `apps/web/src/lib/server/geo/geoprocessing.ts` — 10 PostGIS operations. Currently mocked in router tests; actual SQL untested.
4. **MapEditor $effect orchestration** — 14 effects coordinating 8 stores. Only the extracted state machine is tested.

## For writing-plans

**Safety net map:**
- **Protected seams:** tRPC routers (maps, layers, features, annotations, api-keys, geoprocessing, collaborators, comments, events, shares, admin), store state machines (interaction-modes, drawing, filter, undo), access control (geo-access), audit log integrity.
- **Unprotected seams:** Worker (highest risk), MapCanvas, component composition layer, geoprocessing SQL, file cleanup lifecycle.
- **CI gap:** All local quality tools exist but aren't enforced in CI. First task in any plan should be wiring test/lint/check into CI.

## For verification-before-completion

Team contracts to verify before claiming done:
1. `npm run lint` passes (architectural import boundary rules)
2. `npm run test` passes (73 test files, purposeful invariant tests)
3. `npm run check` passes (svelte-check type validation)
4. No new `any` without `// TYPE_DEBT: <reason>`
5. No new lint suppressions without documented rationale
6. Test names are spec-style descriptive (`rejects X when Y`, not `test_3`)
7. At least 1 adversarial case per test file

## For pattern-advisor

Force clusters identified:
1. **FC1: State machine correctness** — discriminated union pattern vs legacy enum coexistence. Codebook match: `domain-codebooks/state-management`. Status: partially resolved.
2. **FC2: Type safety vs library ergonomics** — strict any-ban with documented escape hatches. No codebook match. Status: stable tension.
3. **FC3: Sequential processing vs parallelism rules** — no-await-in-loop with documented exceptions. No codebook match. Status: fully resolved.
4. **FC4: CI enforcement gap** — quality tooling exists but isn't gated. No codebook match (infrastructure concern). Status: **unresolved, highest priority.**

---

## Design Recommendations (Brownfield)

### Gap-Fill: Priority Additions

**Wave 1: CI Quality Gate (immediate, highest ROI)**
Add to `.github/workflows/ci.yml` before Docker build:
```yaml
- run: pnpm install
- run: pnpm run lint
- run: pnpm run test
- run: pnpm run check
```
This single change activates 73 existing tests + architectural lint rules at deploy time.

**Wave 2: Worker Tests (highest risk untested code)**
Add `services/worker/src/__tests__/worker.test.ts`. Test:
- Each of 6 format parsers produces valid features
- Batch insert SQL generates correct PostGIS geometry
- Job status transitions (queued → active → completed/failed)
- Error handling: malformed file, empty file, oversized file

**Wave 3: Integration Tests for Geoprocessing SQL**
Add `apps/web/src/__tests__/geoprocessing-sql.test.ts` (requires test DB):
- Each of 10 operations on known geometry → expected output
- Empty source layer → empty result (not error)
- Invalid geometry handling

### Improve: Strengthen Existing Tests

- **Dual cache strategy** — Unify MapEditor to use TanStack query instead of direct tRPC calls. Then test cache invalidation as a contract.
- **Legacy InteractionMode removal** — Remove `mapStore.InteractionMode`, update any consumers, delete the dead type.

### Three-Layer Design

| Layer | Recommendation |
|-------|---------------|
| **AI-specific** | Add ESLint rule: no phantom imports (files that don't exist). Extend TYPE_DEBT convention to require `// TYPE_DEBT(issue-id)` linking to a seed. |
| **Code-specific** | Worker integration tests. Geoprocessing SQL tests. Component composition tests for MapEditor $effects (once extracted to composables). |
| **Contributor-agnostic** | Wire existing lint/test/check into CI. No new config needed — just gate enforcement. |
