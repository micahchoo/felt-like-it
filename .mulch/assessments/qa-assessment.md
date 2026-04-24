# QA Assessment: felt-like-it

> Quality-linter Evaluate mode | 2026-04-24 (updated from 2026-03-29)
> Stack: TypeScript + SvelteKit + Turborepo | Vitest + Playwright | ESLint flat config | Prettier

---

## 1. Hotspot-to-Test Mapping

### Hottest Files and Their Test Coverage

| Hotspot File (commits) | Direct Test Coverage | Coverage Quality |
|---|---|---|
| MapEditor.svelte (72) | `map-editor-state.test.ts` | **Strong** — 6 describe blocks testing consolidated state machine |
| AnnotationPanel.svelte (47) | `annotation-service.test.ts`, `annotation-geo.test.ts`, e2e marketing promises | **Moderate** — service/geo tested; panel-level state orchestration untested; 9 bare catch-alls |
| DrawingToolbar.svelte (31) | `drawing-save.test.ts`, `interaction-modes.test.ts` | **Moderate** — save/undo tested, toolbar mutations largely untested directly |
| MapCanvas.svelte (32) | No direct test | **Gap** — 887-line component with complex layer rendering, no unit tests |
| schema.ts (17) | `packages/shared-types/src/__tests__/schemas.test.ts` | **Strong** — exhaustive Zod schema validation with adversarial cases |
| annotations/+server.ts (15) | `annotations-marketing.spec.ts` (e2e) | **Strong** — full API contract via Playwright "marketing promises" spec |
| annotations router (14) | e2e + service tests | **Good** — coverage via e2e + service-layer unit tests |

### Untested Hotspot: MapCanvas.svelte

MapCanvas is the 4th-hottest file with 32 commits and zero direct tests. It contains complex layer rendering logic, GeoJSON source management, annotation pin/region rendering, and the most TYPE_DEBT annotations in the codebase. This is the single largest test coverage gap relative to churn.

---

## 2. Test Classification (sample)

### Classification Summary

| Classification | Count | Percentage |
|---|---|---|
| Purposeful | 16 | ~80% |
| Trivial | 0 | 0% |
| Fragile | 2 | ~10% |
| Orphaned | 1 | ~5% |
| Missing-the-point | 1 | ~5% |

**Zero trivial tests found.** The team does not write tautological tests.

### Notable Test Files

| Test File | Classification | Key Findings |
|---|---|---|
| map-editor-state.test.ts | Purposeful | Excellent state machine tests; atomic operation contracts; adversarial concurrent selection |
| interaction-modes.test.ts | Purposeful (2 Fragile) | Good mode transition tests; 2 tests couple to terra-draw mock internals |
| maps.test.ts | Purposeful | Strong tRPC router tests: CRUD, access control, pagination |
| annotation-service.test.ts | Purposeful | Characterization tests; proper mock isolation |
| annotations-marketing.spec.ts (e2e) | Purposeful | "Marketing promises" API contract tests: pin, region, auth, CRUD, coordinate validation |
| annotation-groups.spec.ts (e2e) | Purposeful | GROUP resource lifecycle; PATCH/delete idempotency |
| layers-store.test.ts | Purposeful | Tests store invariants: sorting, active tracking, mutation isolation |
| features-paged.test.ts | Purposeful (1 Fragile) | One test asserts db.execute call count (fragile to query optimization) |
| geo-engine tests (7 files) | Purposeful | Pure computation: bbox, clustering, spatial operations |

### @ts-nocheck / @ts-expect-error in Tests

`@ts-nocheck` blanket suppressions previously existed in 4 test files. Per mulch record mx-b586f7, team guidance is to replace these with targeted `@ts-expect-error` suppressions. Current state should be verified per file.

---

## 3. Linter & Formatter Audit

### ESLint Configuration

**Architecture: Two-config split (Customized, Architectural)**

| Config | Scope | Key Rules |
|---|---|---|
| Root `eslint.config.js` | packages/ + services/ | Type-aware (`project: true`), `no-floating-promises`, `prefer-nullish-coalescing` |
| `apps/web/eslint.config.js` | Web app | Syntax-only (no `project` — avoids OOM on `.svelte-kit` types) |

**Notable architectural rules:**
- `no-restricted-imports` on `src/lib/components/**` — **prevents components from importing server code** (structural boundary, lint-enforced)
- `svelte/require-each-key` — prevents silent list-rendering bugs
- `consistent-type-imports: error` — enforced everywhere
- `no-await-in-loop: error` — 6 strategic suppressions, all with `-- reason` comments
- `no-explicit-any: error` — enforced; bypassed only via TYPE_DEBT or eslint-disable with reason

**Root vs Web asymmetry:** `no-floating-promises` and `prefer-nullish-coalescing` apply to packages only. Web app uses syntax-only parsing due to OOM with `.svelte-kit` types. Documented in config comments — conscious trade-off.

**Suppressions (31 total):** Strategic, not spray-and-pray.
- `no-await-in-loop`: 7 suppressions in import/export/geocode pipelines — all with reason (sequential batch progress tracking, rate-limit delay)
- `no-undef`: 2 suppressions in geoprocessing (import progress SSE) — structural gap where globals can't be declared
- `@typescript-eslint/no-unsafe-member-access`: 1 in GeoprocessingPanel
- `@typescript-eslint/no-explicit-any`: targeted at IconButton + import-engine (third-party type mismatches)
- `TYPE_DEBT` annotations: 16 instances, all with upstream reason

### Prettier

Full coverage: `**/*.{js,ts,svelte,json,css,md}`. Svelte plugin configured with parser override. Zero style ambiguity. CI-enforced via `format:check` job.

### No Pre-Commit Hooks

No husky/lint-staged configured. Quality enforcement is CI-only. This means a contributor can push code without running lint or format locally.

---

## 4. Force Clusters

### FC1: Mock-Heavy DB Testing (no SQL correctness verification)

**Competing forces:**
- Need for fast, isolated unit tests (Vitest, no DB required)
- Need for confidence that SQL queries actually work
- Drizzle ORM's raw SQL (`db.execute`) is opaque to mocks

**Resolution:** All server-side tests mock `db.execute` via `drizzleChain()` helper from `test-utils.ts`. Consistent and well-executed but SQL correctness is never verified. A query change that breaks in production would pass all tests.

**Inconsistency type:** Cross-cutting divergence (all server tests follow the same mock-heavy pattern; the divergence is between what tests claim to verify and what they actually exercise).

### FC2: Component Complexity vs Testability

**Competing forces:**
- Rich interactive map components (MapCanvas, DrawingToolbar, AnnotationPanel)
- Svelte 5 runes reactivity makes components hard to test in isolation
- `@testing-library/svelte` is installed but unused

**Resolution:** Extract logic into `.svelte.ts` store files and test those as pure state machines. Components are untested at the rendering level. `map-editor-state.test.ts` exemplifies this — pure state machine, no DOM.

**Risk:** Component wiring bugs (wrong props passed, missing event handlers, stale subscriptions) are invisible. The 4 hottest files are all in the untested component layer.

**Inconsistency type:** Boundary-crossing (test strategy is defined at the component/store boundary; everything inside the component boundary is unguarded).

### FC3: Type Safety vs Third-Party Library Types

**Competing forces:**
- `no-explicit-any: error` everywhere
- terra-draw, MapLibre GL, deck.gl, lucide-svelte have type mismatches with Svelte 5

**Resolution:** `TYPE_DEBT` annotations (16 instances) document every forced cast with upstream reason. Grep-able for future cleanup when libraries update. Well-managed.

**Inconsistency type:** Cross-cutting divergence (intentional and documented — not a gap, a resolved force).

### FC4: Import Pipeline Consistency vs Format Diversity

**Competing forces:**
- 6 import formats with different parsing libraries
- Need for consistent output (sanitized features with normalized properties)

**Resolution:** Shared sanitization pipeline (`shared.ts`) with per-format adapters. Each adapter has its own test file. Well-factored. Risk: Low.

### FC5: Silent Error Swallowing in Annotation Components ⚠️ NEW

**Competing forces:**
- Need for resilient UI (don't crash on every network failure)
- Need for visibility into failures (errors disappear silently → impossible to debug)

**Current resolution (failing):** 10+ bare `catch` blocks with no body in AnnotationForm, AnnotationGroups, and AnnotationPanel — no rethrow, no logging, no user feedback. The server layer surfaces errors via HTTP codes and tested contracts; the annotation UI layer silently discards them.

**Evidence:**
- `AnnotationForm.svelte`: lines 108, 132, 249
- `AnnotationGroups.svelte`: lines 61, 89, 101
- `AnnotationPanel.svelte`: lines 186, 198, 212, 225

**No ESLint rule prevents this.** There's no `no-empty` enforcement on catch blocks.

**Inconsistency type:** Cross-cutting divergence (annotation UI is the only subsystem doing this; server layer handles errors correctly).

**Recommended fix:** Add `no-empty: error` to ESLint config (or a custom rule enforcing catch body content). At minimum, log with `console.warn`.

### FC6: Coverage Threshold Intent vs CI Reality ⚠️ NEW

**Competing forces:**
- Team has defined per-package coverage thresholds (aspirational quality bar)
- CI runs `pnpm test` (not `pnpm test:coverage`) — thresholds are **never checked in CI**

**Current resolution (failing):** Coverage thresholds exist in vitest config but are dead letters:

| Package | Line | Function | Branch | Enforced in CI? |
|---|---|---|---|---|
| shared-types | 100% | 100% | 90% | **No** |
| apps/web | 85% | 85% | 80% | **No** |
| geo-engine | 80% | 80% | 75% | **No** |

**Inconsistency type:** Intent-implementation gap (thresholds declared, enforcement absent).

**Recommended fix:** Change the CI `test` job to `pnpm run test:coverage` for packages with thresholds, or add a separate `coverage` job that `needs: [test]`.

---

## 5. Contract Statements

### What This Team Treats as Load-Bearing

1. **Import boundary enforcement** — components cannot import server code (`no-restricted-imports`, lint-enforced)
2. **TYPE_DEBT documentation** — every `any` must be annotated with reason (CLAUDE.md + ESLint)
3. **Suppression justification** — every `eslint-disable` must include a `-- reason` comment
4. **Store isolation** — stores return defensive copies, not internal references
5. **State machine atomicity** — MapEditorState operations update interaction + selection + tool in one synchronous call
6. **Access control at every seam** — `requireMapAccess` called in every tRPC procedure and API endpoint
7. **Schema validation exhaustiveness** — every Zod schema has adversarial input tests
8. **Sanitization pipeline** — all imports pass through XSS stripping and key normalization
9. **API contract testing** — "marketing promises" e2e specs verify user-facing capabilities via public REST API
10. **CI gates: all four hard** — format, lint, test, typecheck must all pass before publish (no `continue-on-error`)

### What This Team Ignores

1. **Component rendering tests** — `@testing-library/svelte` installed but unused
2. **SQL query correctness** — all DB interactions mocked; no integration tests hit real DB
3. **Pre-commit enforcement** — no husky/lint-staged; local quality is not enforced
4. **Coverage enforcement in CI** — thresholds defined but CI never checks them

### What This Team Is Conflicted About

1. **Silent errors in annotation UI** — bare catch-alls in hottest annotation components; no lint rule prevents it
2. **Coverage as a contract** — thresholds defined at different levels per package, but enforced nowhere
3. **Type-aware linting in apps/web** — OOM prevents full enforcement; floating promises invisible to ESLint in web app

---

## 6. Consumer Sections

### For characterization-testing

**Priority gaps (high churn, no tests):**
- **MapCanvas.svelte** (32 commits, 0 tests) — highest-priority gap. Extract paint/layout generation into testable pure functions first.
- **AnnotationPanel.svelte** (47 commits) — panel-level state orchestration (open/close, edit mode, reply threading) untested despite extensive service-layer tests. Also contains 9 bare catch-alls that are invisible bugs.
- **DrawingToolbar.svelte** (31 commits) — save/delete mutation flows partially covered.

**Established pattern:** Extract logic into `.svelte.ts` files, test as pure state machines with DI. See `viewport-store.test.ts` as template.

**Mock infrastructure available:** `test-utils.ts` provides `drizzleChain()`, `mockContext()`, `mockExecuteResult()` for server-side test scaffolding.

### For writing-plans

**Coverage topology:**
- API layer (tRPC routers, services, import pipeline): **well-tested** (mock-based, comprehensive)
- Store layer (`.svelte.ts` stores): **well-tested** (pure state machine tests)
- Component layer (`.svelte` files): **untested** (hottest 4 files are all here)
- Schema layer (shared-types): **thoroughly tested** (100% line/function threshold)
- Package layer (geo-engine, import-engine): **well-tested** (pure computation with thresholds)
- E2E layer: **present** (Playwright marketing promises specs for annotations API)

**When planning new features:** Include store-level tests (team's strong suit). Flag if feature touches MapCanvas or AnnotationPanel (no safety net; also silent error risk).

### For verification-before-completion

**Checklist from team contracts:**
1. `pnpm run lint` passes (includes import boundary check)
2. `pnpm run test` passes
3. `pnpm run check` passes (svelte-check)
4. `pnpm run format:check` passes
5. No new `any` without `// TYPE_DEBT: <reason>`
6. No new `eslint-disable` without `-- reason` comment
7. No bare `catch` blocks — at minimum log with `console.warn`
8. If touching import pipeline: verify sanitization pipeline tests cover the change
9. If touching access control: verify `requireMapAccess` is called

### For pattern-advisor

**Established patterns:**
1. **State extraction:** Logic lives in `.svelte.ts` files, not components. Tests target stores, not DOM.
2. **DI for testability:** Inject `fetchFn`, `getMap`, `getActiveLayer` to test without DOM or network.
3. **drizzleChain mock:** Follow `test-utils.ts` for server-side test scaffolding.
4. **TYPE_DEBT annotation:** Every forced cast gets `// TYPE_DEBT: <upstream reason>`.
5. **Import boundary:** Components in `src/lib/components/` must not import `$lib/server/`.
6. **Marketing promises e2e:** New API capabilities should have a corresponding Playwright spec asserting the user-facing contract.
7. **Adversarial test cases:** Every test file includes at least one adversarial case. Team consistently does this.

---

## 7. Coverage Threshold Topology

```
shared-types:   lines 100% | functions 100% | branches 90% | statements 100% | CI-enforced: NO
geo-engine:     lines  80% | functions  80% | branches 75% | statements  80% | CI-enforced: NO
apps/web:       lines  85% | functions  85% | branches 80% | statements  85% | CI-enforced: NO
import-engine:  (no thresholds configured)
```

Thresholds reflect dependency direction (strict → relaxed: shared-types → app). But **all thresholds are aspirational** — CI runs `pnpm test`, not `pnpm test:coverage`. Closing this gap is a one-line CI change.
