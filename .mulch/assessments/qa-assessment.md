# QA Assessment: felt-like-it

> Quality-linter Evaluate mode | 2026-03-29
> Stack: TypeScript + SvelteKit + Turborepo | Vitest | ESLint flat config | Prettier

---

## 1. Hotspot-to-Test Mapping

### Hottest Files and Their Test Coverage

| Hotspot File (commits) | Direct Test Coverage | Coverage Quality |
|---|---|---|
| MapEditor.svelte (63) | `map-editor-state.test.ts` (NEW, untracked) | **Strong** -- 6 describe blocks testing consolidated state machine |
| AnnotationPanel.svelte (40) | `annotation-service.test.ts`, `annotation-geo.test.ts`, `annotation-objects.test.ts`, `annotation-changelog.test.ts`, `annotation-create-anchors.test.ts` | **Strong** -- characterization tests on service layer + geo derivations |
| DrawingToolbar.svelte (26) | `drawing-undo-closure.test.ts`, `interaction-modes.test.ts` | **Moderate** -- undo closure tested, but toolbar mutations largely untested directly |
| MapCanvas.svelte (25) | No direct test | **Gap** -- 718+ line component with complex layer rendering, no unit tests |
| schema.ts (12) | `packages/shared-types/src/__tests__/schema.test.ts` | **Strong** -- exhaustive Zod schema validation with adversarial cases |
| LayerPanel.svelte (11) | `layers-store.test.ts` | **Moderate** -- store tested, panel UX untested |
| maps.test.ts (11) | Self (tRPC router test) | **Strong** -- CRUD + access control + pagination |

### Untested Hotspot: MapCanvas.svelte

MapCanvas.svelte is the 4th-hottest file with 25 commits and zero direct tests. It contains:
- Complex layer rendering logic (paint/layout generation)
- GeoJSON source management
- Annotation pin/region rendering
- 16+ TYPE_DEBT annotations (most in the codebase)

This is the single largest test coverage gap relative to churn.

---

## 2. Test Classification (20-file sample)

### Classification Summary

| Classification | Count | Percentage |
|---|---|---|
| Purposeful | 16 | 80% |
| Trivial | 0 | 0% |
| Fragile | 2 | 10% |
| Orphaned | 1 | 5% |
| Missing-the-point | 1 | 5% |

### Detailed Classification Table

| Test File | P | T | Fr | O | MtP | Key Findings |
|---|---|---|---|---|---|---|
| map-editor-state.test.ts | 30 | 0 | 0 | 0 | 0 | Excellent state machine tests; atomic operation contracts; adversarial concurrent selection |
| interaction-modes.test.ts | 25+ | 0 | 2 | 0 | 0 | Good mode transition tests but 2 tests couple to mock terra-draw internals |
| maps.test.ts | 20+ | 0 | 0 | 0 | 0 | Strong tRPC router tests: CRUD, access control, pagination |
| annotation-service.test.ts | 12 | 0 | 0 | 0 | 0 | Characterization tests; proper mock isolation; tests service contracts |
| annotation-geo.test.ts | 15+ | 0 | 0 | 0 | 0 | Pure function tests; mixed-input separation is excellent |
| layers-store.test.ts | 10 | 0 | 0 | 0 | 0 | Tests store invariants: sorting, active tracking, mutation isolation |
| undo-store.test.ts | 8 | 0 | 0 | 0 | 0 | LIFO ordering, MAX_HISTORY cap, clear semantics |
| drawing-undo-closure.test.ts | 2 | 0 | 0 | 0 | 0 | Targeted adversarial test for closure capture bug |
| filter-store.svelte.test.ts | 3 | 0 | 0 | 0 | 0 | Defensive copy contract (mutation isolation) |
| viewport-store.test.ts | 15+ | 0 | 0 | 0 | 0 | DI-based testing; race condition test; lifecycle cleanup |
| features-paged.test.ts | 5 | 0 | 0 | 0 | 1 | Runtime validation test correct; one test asserts db.execute call count (fragile to query optimization) |
| features.test.ts | 8 | 0 | 0 | 0 | 0 | Layer-scoped CRUD with access control |
| import-kml-gpx.test.ts | 8 | 0 | 0 | 0 | 0 | Tests coordinate normalization, sanitization, geometry detection |
| import-geojson.test.ts | 5 | 0 | 0 | 0 | 0 | Tests property sanitization pipeline |
| import-csv.test.ts | 6 | 0 | 0 | 0 | 0 | Tests lat/lon detection heuristics |
| import-geopackage.test.ts | 10+ | 0 | 1 | 0 | 0 | Good batch processing tests; one test couples to internal batch size |
| import-shapefile.test.ts | 5 | 0 | 0 | 0 | 0 | Tests multi-layer shapefile handling |
| import-shared.test.ts | 5 | 0 | 0 | 0 | 0 | Sanitization pipeline: XSS stripping, key normalization |
| geo-access.test.ts | 6 | 0 | 0 | 0 | 0 | Permission escalation tests: owner > editor > viewer |
| collaborators.test.ts | 8 | 0 | 1 | 0 | 0 | Tests invite/accept/remove flow; one test potentially orphaned if tRPC router changed |
| schema.test.ts (shared-types) | 30+ | 0 | 0 | 0 | 0 | Exhaustive Zod schema validation; adversarial geometry inputs |
| geo-engine tests (7 files) | 25+ | 0 | 0 | 0 | 0 | Pure computation: bbox, clustering, spatial operations |

**Zero trivial tests found.** This is notable -- the team does not write tautological tests.

### @ts-nocheck Usage in Tests

5 test files use `@ts-nocheck`:
- `annotation-service.test.ts` -- "strict null checks on array access are noise"
- `interaction-modes.test.ts` -- "Geometry type mismatches are noise"
- `features-paged.test.ts` -- uses `@ts-expect-error` for intentional bad input (correct usage)
- `annotation-geo.test.ts` -- "strict array-index null checks are noise"
- `viewport-store.test.ts` -- "Mock type mismatches and strict null checks are noise"

**Pattern:** The team disables type checking in tests when mock types diverge from production types. This is a pragmatic choice but creates drift risk -- mock shapes can silently diverge from production types over time.

---

## 3. Linter & Formatter Audit

### ESLint Configuration

**Architecture: Two-config split (Customized, Architectural)**

| Config | Scope | Key Rules |
|---|---|---|
| Root `eslint.config.js` | packages/ + services/ | Type-aware (`project: true`), `no-floating-promises`, `prefer-nullish-coalescing` |
| `apps/web/eslint.config.js` | Web app | Syntax-only (no `project` -- avoids OOM), separate Svelte/`.svelte.ts` configs |

**Notable architectural rules:**
- `no-restricted-imports` on `src/lib/components/**` -- **prevents components from importing server code**. This is a real boundary enforcement rule, not boilerplate.
- `svelte/require-each-key` -- prevents silent list-rendering bugs
- `consistent-type-imports` -- enforced everywhere, prevents runtime-import of type-only modules
- `no-await-in-loop` -- catches sequential-when-parallel-is-possible

**Root vs Web asymmetry:** Root config has `no-floating-promises` and `prefer-nullish-coalescing` (type-aware rules). Web config does not because type-aware parsing OOMs on `.svelte-kit` types. This is documented in comments -- a conscious trade-off, not negligence.

**Verdict: Customized and Architectural.** The import boundary rule is the standout -- it structurally prevents the most common SvelteKit mistake (importing server code in components).

### Prettier Configuration

```json
{
  "useTabs": false, "tabWidth": 2, "singleQuote": true,
  "trailingComma": "es5", "printWidth": 100, "semi": true,
  "plugins": ["prettier-plugin-svelte"]
}
```

**Verdict: Standard with one customization** (printWidth: 100, up from default 80). Svelte plugin is correctly configured with parser override. No friction points.

### Inline Suppression Audit

| Type | Count | Strategic? |
|---|---|---|
| `eslint-disable` (inline) | 6 instances in 4 files | **All strategic** -- every suppression has a `-- reason` comment explaining why |
| `@ts-nocheck` | 4 test files | **Semi-strategic** -- documented but blanket; prefer `@ts-expect-error` per-line |
| `@ts-expect-error` | 1 instance | **Correct** -- used for intentional bad input in validation test |
| `TYPE_DEBT` | 16 instances in 12 files | **Strategic** -- every annotation explains the upstream type mismatch |

**Verdict: Suppressions are strategic, not spray-and-pray.** Every `eslint-disable` includes a reason comment. `TYPE_DEBT` annotations follow the project convention from CLAUDE.md. The only concern is `@ts-nocheck` in test files -- blanket suppression rather than targeted `@ts-expect-error`.

### knip (Dead Code Detection)

`knip` is configured in `package.json` scripts. This is an unusual and positive signal -- the team actively hunts dead exports and unused dependencies.

---

## 4. Force Clusters

### FC1: Mock-Heavy DB Testing vs Integration Testing

**Competing forces:**
- Need for fast, isolated unit tests (Vitest, no DB required)
- Need for confidence that SQL queries actually work
- Drizzle ORM's raw SQL (`db.execute`) is opaque to mocks

**Current resolution:** All server-side tests mock `db.execute` and use a `drizzleChain()` helper from `test-utils.ts` to simulate Drizzle's fluent API. This is consistent and well-executed but means SQL correctness is never verified by tests.

**Evidence:** `annotation-service.test.ts`, `features-paged.test.ts`, `collaborators.test.ts`, `maps.test.ts` all use the same mock pattern.

**Risk:** A SQL query change that breaks in production would pass all tests.

### FC2: Component Complexity vs Testability

**Competing forces:**
- Rich interactive map components (MapCanvas, DrawingToolbar, AnnotationPanel)
- Svelte 5 runes reactivity makes components hard to test in isolation
- No jsdom tests for Svelte components exist in the codebase

**Current resolution:** Extract logic into `.svelte.ts` store files and test those as pure state machines. Components are untested at the rendering level. The `map-editor-state.test.ts` exemplifies this pattern -- it tests the consolidated state machine that replaced bridge effects.

**Evidence:** `viewport-store.test.ts` uses DI (dependency injection) to test without DOM. `filter-store.svelte.test.ts` tests pure store logic. No `@testing-library/svelte` render tests exist despite the dependency being installed.

**Risk:** Component wiring bugs (wrong props passed, missing event handlers, stale subscriptions) are invisible to the test suite.

### FC3: Type Safety vs Third-Party Library Types

**Competing forces:**
- Team enforces `no-explicit-any` as error everywhere
- Third-party libraries (terra-draw, MapLibre GL, deck.gl, lucide-svelte) have type mismatches with Svelte 5
- GeoJSON types lack index signatures needed for Drizzle/tRPC schema casting

**Current resolution:** `TYPE_DEBT` annotations (16 instances) document every forced cast with upstream reason. `eslint-disable` for `no-explicit-any` is used exactly once (IconButton.svelte) with documentation.

**Evidence:** `DrawingToolbar.svelte` (3 TYPE_DEBT), `MapCanvas.svelte` (3 TYPE_DEBT), `DeckGLOverlay.svelte` (2 TYPE_DEBT), `IconButton.svelte` (1 TYPE_DEBT + eslint-disable).

**Risk:** Low. The team manages this tension well. TYPE_DEBT gives grep-ability for future cleanup when libraries update.

### FC4: Import Pipeline Consistency vs Format Diversity

**Competing forces:**
- 6 import formats (CSV, GeoJSON, GeoPackage, KML/GPX, Shapefile) with different parsing libraries
- Need for consistent output (sanitized features with normalized properties)
- Each format has unique edge cases (coordinate systems, encoding, multi-layer)

**Current resolution:** Shared sanitization pipeline (`import-shared.test.ts`) with per-format adapters. Each adapter has its own test file. The `shared.ts` module handles XSS stripping and key normalization across all formats.

**Evidence:** All 6 import test files exist and test format-specific edge cases. `import-shared.test.ts` tests the common pipeline.

**Risk:** Low. This is well-factored.

### FC5: CI Quality Gate Completeness

**Competing forces:**
- CI runs lint + test + check on push to main/master
- No pre-commit hooks (no husky, no lint-staged)
- No PR-triggered CI (only push to main branches)
- No format:check in CI pipeline

**Current resolution:** CI gate is post-merge only. Formatting errors can land in main.

**Evidence:** `.github/workflows/ci.yml` triggers on `push: branches: [main, master]` only. No `pull_request` trigger. `format:check` is available as a script but not in CI.

**Risk:** Medium. Broken formatting or lint errors can reach main. The team relies on developer discipline rather than automated gates.

---

## 5. Contract Statements

### What This Team Treats as Load-Bearing

1. **Import boundary enforcement** -- components cannot import server code (ESLint structural rule)
2. **TYPE_DEBT documentation** -- every `any` must be annotated with reason (CLAUDE.md + ESLint)
3. **Suppression justification** -- every `eslint-disable` must include a reason comment
4. **Store isolation** -- stores return defensive copies, not internal references (filter-store, layers-store)
5. **State machine atomicity** -- MapEditorState operations must update interaction + selection + tool in one synchronous call
6. **Undo closure correctness** -- closures must capture their own feature ID, not a shared mutable reference
7. **Access control at every seam** -- `requireMapAccess` called in every tRPC procedure and API endpoint
8. **Schema validation exhaustiveness** -- every Zod schema has adversarial input tests (shared-types: 100% line/function coverage threshold)
9. **Sanitization pipeline** -- all imports pass through XSS stripping and key normalization

### What This Team Ignores

1. **Component rendering tests** -- `@testing-library/svelte` is installed but unused
2. **SQL query correctness** -- all DB interactions are mocked; no integration tests
3. **Pre-commit enforcement** -- no hooks; relies on developer discipline
4. **E2E tests** -- Playwright is configured but no test files found in sample
5. **Format checking in CI** -- `format:check` exists but is not in the CI pipeline

### What This Team Is Conflicted About

1. **@ts-nocheck in tests** -- used for pragmatism (mock type mismatches) but creates silent drift risk. Team knows this is sub-optimal (the comments say "noise") but hasn't migrated to per-line `@ts-expect-error`.
2. **Coverage thresholds** -- `shared-types` has 100% line coverage threshold; `geo-engine` has 85%; `apps/web` has none. Inconsistent stance on coverage as a contract.
3. **CI trigger scope** -- CI only runs on push to main, not on PRs. This suggests either (a) sole developer workflow where PR reviews aren't the norm, or (b) a gap that should be closed.

---

## 6. Consumer Sections

### For characterization-testing

**Where to focus characterization tests:**
- **MapCanvas.svelte** (25 commits, 0 tests) -- highest-priority gap. Start by extracting paint/layout generation into testable pure functions, then characterize them.
- **DrawingToolbar.svelte** (26 commits, partial coverage) -- the save/delete mutation flows are untested. Characterize the `saveFeature()` flow end-to-end.
- **AnnotationPanel.svelte** (40 commits) -- service layer is well-tested but panel-level state orchestration (open/close, edit mode, reply threading) is not.

**Testing pattern already established:** Extract logic into `.svelte.ts` files, test as pure state machines with DI. Follow `viewport-store.test.ts` as the template -- it demonstrates DI-based testing with mock map instances.

**Mock infrastructure available:** `test-utils.ts` provides `drizzleChain()`, `mockContext()`, `mockExecuteResult()` for server-side test scaffolding.

### For writing-plans

**Coverage topology for planning:**
- Server layer (tRPC routers, services, import pipeline): **well-tested** -- mock-based but comprehensive
- Store layer (`.svelte.ts` stores): **well-tested** -- pure state machine tests
- Component layer (`.svelte` components): **untested** -- no render tests exist
- Schema layer (shared-types): **thoroughly tested** -- 100% coverage threshold
- Package layer (geo-engine, import-engine): **well-tested** -- pure computation with coverage thresholds
- E2E layer: **absent** -- Playwright configured but no tests

**When planning new features:** Ensure the plan includes store-level tests (the team's strong suit) and consider whether the feature touches MapCanvas (no safety net).

### For verification-before-completion

**Verification checklist derived from team contracts:**
1. `pnpm run lint` passes (includes import boundary check)
2. `pnpm run test` passes
3. `pnpm run check` passes (svelte-check)
4. No new `any` without `// TYPE_DEBT: <reason>`
5. No new `eslint-disable` without `-- reason` comment
6. If touching import pipeline: verify sanitization pipeline tests cover the change
7. If touching access control: verify `requireMapAccess` is called
8. If touching state management: verify store returns defensive copies

### For pattern-advisor

**Established patterns to follow:**
1. **State extraction pattern:** Complex component logic lives in `.svelte.ts` files, not in components. Tests target the store, not the DOM.
2. **DI for testability:** `viewport-store.test.ts` demonstrates injecting mock dependencies (fetchFn, getMap, getActiveLayer) to test store behavior without DOM or network.
3. **drizzleChain mock pattern:** All server tests use `test-utils.ts` helpers to mock Drizzle's fluent API. Follow this pattern for new tRPC procedure tests.
4. **TYPE_DEBT annotation:** When forced to cast due to third-party type mismatches, annotate with `// TYPE_DEBT: <upstream reason>`.
5. **Import boundary:** Components in `src/lib/components/` must not import from `$lib/server/`. This is lint-enforced.
6. **Adversarial test cases:** Every test file should include at least one adversarial case (empty input, malformed data, boundary values). The team consistently does this.

---

## 7. Coverage Threshold Topology

```
shared-types:    lines 100% | functions 100% | branches 90% | statements 100%
geo-engine:      lines  85% | functions  85% | branches 80% | statements  85%
import-engine:   (no thresholds configured)
apps/web:        (no thresholds configured)
```

The gradient from shared-types (strictest) to apps/web (none) reflects dependency direction: shared packages are the foundation and get the tightest contracts. Application code has no coverage gates, relying on the test suite's natural coverage.

---

## 8. Deleted Files in Working Tree

The git status shows several deleted files:
- `drawing-store.test.ts` (deleted)
- `selection-store.test.ts` (deleted)
- `drawing.svelte.ts` (deleted)
- `selection.svelte.ts` (deleted)
- `interaction-modes.svelte.ts` (deleted)
- `useInteractionBridge.svelte.ts` (deleted)

These deletions correlate with the new `map-editor-state.svelte.ts` and `map-editor-state.test.ts` (untracked). This is an active consolidation: separate drawing/selection/interaction stores are being merged into a single MapEditorState. The old tests are deleted; new tests cover the consolidated state machine.

**Risk:** Until committed, the test for the old stores is gone and the new test is untracked. If this branch is abandoned, both old and new tests are lost.
