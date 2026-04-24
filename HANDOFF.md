# Handoff

## Goal
"This is full of spaghetti code, the ui is a mess and most likely the backend as well" — diagnose the architecture and start cleaning it up.

## Progress

### Prior sessions (through `8a9aae9`)
- Codebase diagnosis + 5-batch refactor (MapEditor extraction, filter store, TYPE_DEBT reduction, export API namespace move, CI parallel quality jobs)
- Baseline going into this session: **svelte-check 115 errors / 8 warnings / 36 files** (typecheck was a soft-gate in CI)

### This session (TypeScript backlog cleanup toward hard gate)
Net delta: **115 → 51 errors (−64, −56%)** — and **0 errors in source code**. All 51 remaining are test-fixture drift.

**Clusters fixed (in order):**
1. ✅ **DataLayerRenderer MapLayerMouseEvent** (−18) — widened local `LayerMouseEvent` type from `MapMouseEvent & {features?}` to `MapLayerMouseEvent`. Cast feature at the parent-callback boundary.
2. ✅ **MeasurementResult dual-type unification** (−4, structural) — canonical type is now the store's `MeasurementResult` (has `geometry` field for annotation save). Converted to a **discriminated union** `{type:'distance', ...} | {type:'area', ...}` so distance/area fields narrow by `.type`. Redirected 4 imports from `@felt-like-it/geo-engine` to `$lib/stores/measurement-store.svelte.js`. Updated `MeasurementPanel` to use `mr.geometry` instead of non-existent `mr.coordinates`. DrawingToolbar's `onmeasured` callback keeps the raw geo-engine types (`DistanceMeasurement | AreaMeasurement`) since that's what `measureLine`/`measurePolygon` return — the store adapts via `setResult()`.
3. ✅ **Share/Embed discriminated union narrowing** (−9, via Worker B) — narrowed `ShareViewerData.map` to `Pick<MapRecord, 'id' | 'title' | 'viewport' | 'basemap'>` to match the loader's security-driven narrow payload. Client pages narrow via `{#if 'error' in data}{:else}`. `<svelte:head>` stays at top level (Svelte forbids it inside blocks) using a small `$derived` ternary.
4. ✅ **TanStack Query v6 MutationOptions migration** (−~12, via Worker A) — added 4th `TContext` generic to `MutationOptions<TData, TError, TVariables, TContext>` on all factories in `AnnotationMutations.ts`. v6's `onError` receives `(err, vars, onMutateResult, context)` — the 3rd arg is what v5 called `context`. Dropped inline `context:` annotations. Changed `TData=void` → `Awaited<ReturnType<typeof trpc.x.mutate>>` where mutationFn returned non-void. Rewrote optimistic annotation literal to match real `AnnotationObject` (camelCase + required nullable fields).
5. ✅ **Small-fix cluster** (via Worker C): `toastStore.add` → `.success`, `autofocus` removal on Login/Register, `no-await-in-loop` block disable in export server with SSE progress rationale, unused imports, `ReadableStream` global, `_url` unused-arg.
6. ✅ **DrawingToolbar rework**: `SnapshotFeature` widened to match terra-draw `GeoJSONStoreFeatures` under `exactOptionalPropertyTypes` (`id?: string | number | undefined`, required `properties: Record<string, unknown>`). `featureUpsertMutation` retyped with a `FeatureUpsertInput` type so TanStack v6 infers TVariables correctly through onSuccess/onError.
7. ✅ **Export server joined-query rewrite** (`api/v1/export/+server.ts`, `api/v1/export/progress/+server.ts`) — no Drizzle `relations()` declared in this project, so `with: { map: true }` failed. Rewrote ownership checks as explicit `.innerJoin(maps, eq(layers.mapId, maps.id))` selecting `maps.userId`. Maps schema field is `userId`, not `ownerId`. Added `throw error(...)` prefix so TS narrows `locals.user`.
8. ✅ **Paginated cursor type casts** (4 route files) — `typedExecute<Record<string, unknown>>` made `last.createdAt`/`last.created_at` type `unknown`. Cast at `encodeCursor(... as string | Date, ... as string)` call sites. Proper fix would be typing `typedExecute<MapRow>` with concrete shapes — left as future cleanup.
9. ✅ **useLayerDataManager** — `queryKeysFn: (id) => unknown[]` → `readonly unknown[]` to accept `as const` tuples from `queryKeys.features.list(...)`.
10. ✅ **AnnotationList/Content/Thread props** — `userId?: string` → `userId?: string | undefined` and `onconverttopoint?: () => void` → `?: (() => void) | undefined` to satisfy `exactOptionalPropertyTypes` when callers pass `string | undefined` or `undefined`.
11. ✅ **AnnotationPanel anchor narrowing** — replaced unsafe `as { coordinates: [...] }` casts with explicit narrowing through `anchor.geometry.coordinates` (the anchor is geometry-wrapped, not flat). Safe-guards for empty rings.
12. ✅ **resolveFeatureId signature** — widened to accept `id?: string | number | undefined` (MapLibre GeoJSONFeature shape).
13. ✅ **MapCanvas MapLibre undefined bind** — `bind:map={mapInstance as unknown as maplibregl.Map}` with TYPE_DEBT comment. Library types the prop as required; bind writes it post-mount.
14. ✅ **import-engine declarations** — `shpjs` and `sql.js` have no `.d.ts`. Added inline `@ts-expect-error` (shpjs) and `as any` cast (sql.js) with TYPE_DEBT comments. `src/declarations.d.ts` shims added but didn't pick up under current tsconfig/project-reference traversal.

### Remaining (0 errors)
Fixture-alignment worker completed. All snake_case → camelCase, flat anchor → geometry-wrapped, MeasurementResult discriminated-union realignment applied across 11 test files. **Session closed at svelte-check 0 errors / 6 warnings / 4 files.**

### Hard gate flipped
`ci.yml` typecheck now runs without `continue-on-error` and is added to `publish.needs`. Any TS regression in a PR will fail the job and block image publish.

## Smoke test results
- `pnpm run check 2>&1 | tail -3` at session close: **51 errors / 6 warnings / 15 files**, down from 115/8/36.
- 0 errors in `apps/web/src/**` source; 0 errors in `packages/import-engine/src/**` after shims.
- Remaining 51 errors all in `apps/web/src/__tests__/*.test.ts` (worker finishing).
- 6 warnings left: 2× MapEditor `mapId` closure-capture (Svelte 5 state-capture advice), 2× AnnotationForm `pendingMeasurementData` closure-capture, 1× Modal non-reactive `dialogEl`, 1× GeoprocessingPanel self-closing `<div />`. None block typecheck.

## What Worked
- **Advisor checkpoint before editing** produced a cluster priority that held throughout — mechanical fixes first (kill 18 errors in 1 edit), then the structural `MeasurementResult` decision, then parallel workers on disjoint clusters.
- **3 parallel workers with disjoint file scope** (AnnotationMutations.ts, share/embed pages, small-fix cluster) — no cross-worker merge conflicts. Delta added up cleanly.
- **Discriminated union for `MeasurementResult`** — swapping the interface for `type: 'distance' | 'area'` with different required fields per variant simultaneously fixed optional-field errors AND eliminated the need for `result.coordinates` casts downstream.
- **Path-scoped joins instead of Drizzle `with: { map }`** — the query API can't work without `relations()` declarations; explicit `.innerJoin` is clearer anyway and fixes both the `never` type inference AND the `ownerId` vs `userId` field drift.
- **`readonly unknown[]` on consumer side** preserved the `as const` branding on query-keys (load-bearing for TanStack inference) without widening the producer.

## What Didn't Work
- **Shim `.d.ts` in `packages/import-engine/src/`** — `declare module 'shpjs'` / `declare module 'sql.js'` wasn't picked up by svelte-check running from `apps/web`. Project references + module resolution edge case. Fell back to inline `@ts-expect-error` + `as any` cast per consuming file.
- **Tight MutationOptions cast via `as unknown as (input: unknown) => Promise<T>`** — erased TVariables inference in TanStack v6. Worker A fix: preserve the input type in the outer cast (`as unknown as (input: FeatureUpsertInput) => Promise<{upsertedIds: string[]}>`), and annotate onSuccess/onError's `variables` param with the same type. v6 widens TVariables across callback types.
- **Boolean `hasError` narrowing across `<svelte:head>`** — `<svelte:head>` cannot live inside `{#if}` (Svelte restriction). Use a top-level `$derived` ternary on the discriminant to compute the `<title>` string; put the body inside `{#if 'error' in data}{:else}`.

## Key Decisions
- **Canonical `MeasurementResult` is the store's**, not geo-engine's. Reason: the store type carries the `geometry` field (required for annotation save); geo-engine returns raw `DistanceMeasurement`/`AreaMeasurement` with flat `coordinates`. Store converts via `fromGeoEngine()`.
- **`exactOptionalPropertyTypes: true` stays on** (mulch mx-fa1de1). Fixes add `| undefined` to optional props, they don't flip the flag.
- **Explicit `throw error(...)` over bare `error(...)`** in SvelteKit handlers — SvelteKit's `error()` returns `never` but closure-level type narrowing of `locals.user` doesn't always flow through an async callback. Extract `const user = locals.user` after the top-level guard.
- **Cursor `unknown` casts left at call sites**, not fixed at `typedExecute<T>` — the pagination query result types would need a full pass. Not in scope for this session.

## Infrastructure Delta
- No CI/infra changes this session. Files staged for commit:
  - `apps/web/src/lib/components/**/*.svelte` (AnnotationContent, AnnotationList, AnnotationMutations.ts, AnnotationPanel, AnnotationThread, DataLayerRenderer, DrawingToolbar, MapCanvas, MapEditor, MeasurementPanel, useLayerDataManager.svelte.ts)
  - `apps/web/src/lib/stores/measurement-store.svelte.ts` (discriminated union)
  - `apps/web/src/lib/utils/resolve-feature-id.ts` (signature widening)
  - `apps/web/src/lib/screens/{LoginScreen,RegisterScreen,SettingsScreen}.svelte`
  - `apps/web/src/lib/contracts/share-viewer.ts` (ShareViewerMap narrow)
  - `apps/web/src/routes/(public)/{share,embed}/[token]/+page.svelte`
  - `apps/web/src/routes/api/v1/export/**/*` (join rewrite, progress narrow)
  - `apps/web/src/routes/api/v1/maps/**/*` (cursor casts, annotations/[id] spread)
  - `apps/web/src/routes/api/import/progress/+server.ts`
  - `apps/web/src/lib/stores/export-store.svelte.ts`
  - `packages/import-engine/src/{shapefile,geopackage}.ts` + new `declarations.d.ts`

## Knowledge State
- Indexed: none new via `context add`.
- Gaps: Drizzle `relations()` are not declared anywhere in this project, but `db.query.*.findFirst({ with: {...} })` is used in multiple route handlers. Most calls silently degrade to `never` types. Either declare relations (`packages/schema` or `apps/web/src/lib/server/db/`) or migrate remaining `with:` calls to explicit joins. 2 calls fixed this session; check others via `grep -rn 'with: { map' apps/web/src`.
- Gaps: `typedExecute<Record<string, unknown>>` appears in 4+ route files — typing the concrete row shapes would replace all 4 cursor-cast `as string | Date` workarounds. Future cleanup.

## Next Steps

**Done this session (commit `5271385`):**
- Task #9 ✅ — svelte-check 0 warnings (was 6): FiltersStore getter constructor, MapEditor closures, AnnotationForm $effect, Modal $state, GeoprocessingPanel div
- Task #10 ✅ — DrawingToolbar `featureUpsertMutation`/`featureDeleteMutation`: explicit `createMutation<TData, TError, TVariables, TContext>` generics; `as unknown as (fn)` removed
- Task #8 ✅ — annotations/+server.ts cursor casts removed; `last` sourced from typed `result.items` directly

**Priority 1 — remaining tech debt:**
1. **Declare Drizzle `relations()`** schema-wide. Task #7 (deferred — no active bug; 2 `db.query.findFirst` sites cleaned up via explicit joins). Revisit before adding new `with:{}` queries.
2. **Proper d.ts shims for shpjs + sql.js** (packages/import-engine). Task #12. `declarations.d.ts` in src/ wasn't picked up — inline `@ts-expect-error` and `as any` applied. Investigate tsconfig `types`/`typeRoots` entry.
3. **Lint backlog**: `pnpm run lint` shows 269 errors — mostly pre-existing (no-non-null-assertion, no-await-in-loop, unused vars, svelte/require-each-key). Needs dedicated cleanup session.
9. **Lint backlog**: `pnpm run lint` shows 269 errors — mostly pre-existing (no-non-null-assertion, no-await-in-loop, unused vars, svelte/require-each-key). `lint` IS in `publish.needs` but the historical state means publish may have been failing quietly. Needs a dedicated cleanup session.

**Priority 2 — from prior session:**
10. **MapEditor final extraction** (1006 → <950 LOC) — extract 30-LOC dialog sync effects (lines ~150-180) into an `editorLayout` method. Behavior change — do after design review.
11. **Test env fixups** — 13 pre-existing test failures: sql.js/GeoPackage WASM loading + pg CJS↔ESM interop.
12. **Enforce branch protection** per `.github/branch-protection.md` on GitHub UI (manual).

## Context Files
- `HANDOFF.md` — this file
- `apps/web/src/lib/stores/measurement-store.svelte.ts` — discriminated union + `fromGeoEngine`
- `apps/web/src/lib/components/annotations/AnnotationMutations.ts` — v6 MutationOptions pattern reference
- `apps/web/src/routes/api/v1/export/+server.ts` — joined-query ownership check pattern
- `apps/web/src/lib/contracts/share-viewer.ts` — `ShareViewerData` narrowed to loader's public payload
- `.github/workflows/ci.yml` — CI pipeline; flip `typecheck` gate once fixtures land
- `.github/branch-protection.md` — GitHub UI enforcement instructions

---

## Session 2026-04-24 — Felt-parity cycle

### Goal
Ship the Felt-parity annotation surface: close the 14 marketing-promise gaps, then deliver the 4 Felt-parity deltas from the bible (name+description, groups, styling, convert).

### Delivered (commits this session)

- `feat(annotations): pure styleToPaint helpers` — renderer-groundwork for Wave 2 Task 3.3 (8 unit tests, not yet wired)
- `feat(annotations): per-annotation style column + passthrough` — migration 0012 + service/tRPC/REST passthrough (Wave 2 Task 3.1-3.2)
- `feat(annotations): groups/folders server` — migration 0011 + service + tRPC subrouter + REST CRUD (Wave 2 Task 2.1-2.3)
- `feat(annotations): Wave 3 UI — Promote-to-layer button + measurement gap note`
- `feat(annotations): convert annotation ↔ layer` — Wave 3 service + API (Task 4.1-4.3)
- `docs(product): measurement persistence decision + Wave 1 audit`
- `docs(api): versioning policy + backfill spike` (closes seed `1674`)
- `feat(annotations): name+description UI` (Wave 1 Task 1.4)
- `feat(annotations): name+description server` (Wave 1 Task 1.1-1.3, migration 0010)
- `docs(product): strategy cycle 01` — vision, 3 personas, KPIs, RICE roadmap
- `feat(annotations): REST marketing coverage + UI safety + Wave 0 schema skeleton`

**Tests**: 41/41 REST marketing tests pass (`apps/web/e2e/api/annotations-marketing.spec.ts`). `pnpm check` clean throughout.

### State of the Felt-parity plan

- **Wave 0** — contract skeleton — done
- **Wave 1** — name+description (seed `06b2`) — done end-to-end
- **Wave 3** — convert annotation ↔ layer (seed `41c9`) — server + forward-direction UI; reverse-direction UI deferred
- **Wave 2 Groups** (seed `2e48`) — server done; UI (Task 2.4) deferred
- **Wave 2 Styling** (seed `5179`) — server + styleToPaint helper w/ 8 tests done; renderer wiring (3.3) + Style panel UI (3.4) deferred

### Closed seeds
`felt-like-it-6ba4`, `-20c1`, `-80bd`, `-5fd1`, `-784d`, `-7432`, `-1674`, `-34c1`.

### Open work for next session (ranked)

1. **Wire `styleToPaint` helpers into AnnotationRenderer.svelte (Task 3.3)** — smallest remaining risk. Paint constants live at lines 77-94. Spread `lineStylePaint/fillStylePaint/pinStylePaint` into each existing `paint={...}`. The pure helper is unit-tested — only the wiring remains. Feature-state expressions needed to apply per-annotation styles cleanly (feature props need style folded in at GeoJSONSource build time).

2. **Ship AnnotationStylePanel.svelte (Task 3.4)** — right-panel Style tab. Stroke width slider, stroke-style radio (solid/dashed/dotted), colour pickers (reuse `apps/web/src/lib/components/map/StylePanel.svelte` if compatible), opacity slider, show-label toggle. Wire through `updateAnnotationMutationOptions` (already accepts `style: object | null`).

3. **Ship AnnotationGroups.svelte (Task 2.4)** — collapsible folder headers in side panel. Use `trpc.annotations.listGroups` query + `createGroup` / `updateGroup` / `deleteGroup` mutations (already in the router). Start with: create, rename inline, delete, group-membership dropdown. Drag-drop reorder is nice-to-have.

4. **Reverse-direction convert UI** — LayerPanel context menu "Convert features to annotations". tRPC mutation `convertLayerFeaturesToAnnotations` already exists.

5. **Regen plan manifest baseline** — `bash ~/.claude/scripts/post-implementation-audit.sh apps/web/docs/plans/felt-parity-annotations.md --baseline`.

### Gotchas discovered this session

- **Dev server restart flow**: killing the dev server also exits the compose containers. Run `docker start felt-like-it-postgres-1 felt-like-it-redis-1` before re-running e2e. First post-restart e2e may 401 until seed:reset completes in global-setup.
- **Transaction vs top-level db**: `insertFeatures` in `geo/queries.ts` uses module-level `db` — if called from inside a `db.transaction(tx => ...)` block, the features INSERT can't see uncommitted parent rows. Thread `tx` into SQL calls inside a transaction, or inline the SQL (I inlined in `convert.ts`).
- **Migration filename collisions**: migrator keys by filename, so `0010_add_annotation_name_description.sql` and pre-existing `0010_drop_is_archived.sql` coexist. Keep monotonic numbering even when prefix clashes.
- **Raw SQL row types**: `typedExecute<T>` casts but Postgres may return `timestamp` as string under some conditions. `annotation.created_at.toISOString()` crashed in `convert.ts`. Guard with `instanceof Date ? .toISOString() : String(x)`.
- **jsonb writes**: always `JSON.stringify` explicitly — don't pass raw objects into `sql\`…\`\` interpolations.

### What did not make this session
- Live UI shadow-walk of "Promote to layer" button (REST coverage only).
- `.mulch/expertise/meta.jsonl` update for today's learnings — gotchas above are good candidates for convention records.
