# Handoff

## Goal

Resumed prior `2250bc0` handoff. User-driven workflow: `/check-handoff and executer` → "continue as per plan" (×5) → "this product has no users, no retrofitting necessary" → user picked **D-α** for Wave D, then "do 2 and 1" for migration + smoke, then F13 Sharing as next epic.

**Phase 3 epic baa4 closed under D-α resolution.** Waves A → D shipped + DB-layer smoke verified. Migration applied to dev DB.

**F13 Sharing 3/4 sub-waves shipped:** F13.1 (hash-state viewport URL), F13.2 (dedupe token resolution), F13.3 (link expiration: backend + UI). F13.4 (lightweight viewer / bundle-split) deferred to next session — riskiest sub-wave, deserves a fresh head.

## Progress

### Commits this session (16+ total — A:4, B:2, D-α plan:1, D-α D.1+D.2:1, D.3:1, D.4-A:1, handoff:2, mulch sync:1, F13.1:1, F13.2:1, F13.3:1)

**Wave A — TerraDraw → annotations dispatch flip:**
- 🔼 `62b37e4` — A.1 saveAsAnnotation parallel function in DrawingToolbar (+~75 LOC, additive only)
- 🔼 `e25099c` — A.1 vitest characterization spec (`drawing-save-annotation.test.ts`, 15 tests at first iteration)
- 🔼 `56869b1` — A.2 flip `draw.on('finish')` dispatch to saveAsAnnotation
- 🔼 `cfdaec0` — A.4 narrow `onannotationdrawn(id, anchorType)` callback for activity logging; superseded the broken-on-arrival A.2 bridge call to `onfeaturedrawn`

**Wave B — features-table application-write lock-down:**
- 🔼 `3b25ce6` — B.2 client dead-code purge: `saveFeature`, `featureUpsertMutation`, `featureDeleteMutation`, `onfeaturedrawn` Props chain (DrawingToolbar + MapCanvas + MapEditor's `handleFeatureDrawn`), DELETED `apps/web/src/__tests__/drawing-save.test.ts`. Net -717 LOC.
- 🔼 `fe4261e` — B.3 server cleanup: drop `features.upsert` + `features.delete` tRPC procs + dependent imports + tests. Added `.claude/rules/features-table-write-boundary.md` documenting the whitelist (imports/, geo/, maps/operations.ts, annotations/convert.ts, export/geopackage.ts).

**Plan amendment:**
- 🔼 `50ce980` — surfaced Wave D blockers (annotation_objects has no layerId — required design decision) + rescoped Wave E/F under different D-resolution paths.

**Wave D-α — full path (D.1-D.4):**
- 🔼 `31640eb` — D.1+D.2 atomic: migration `0019_add_layer_id_to_annotations.sql` (ADD layer_id UUID NULL REFERENCES layers ON DELETE SET NULL + composite index) + drizzle schema + shared-types `AnnotationObjectSchema` / `CreateAnnotationObjectSchema` + `annotationService.list({layerId})` filter + `annotationService.create({layerId})` insert + tRPC list/create + REST GET layerId param + REST POST + `toAnnotation` serializer. **Migration applied to dev DB (`docker exec ... psql`).**
- 🔼 `9abdc13` — D.3 wire DrawingToolbar.saveAsAnnotation to pass `layerId: activeLayer.id`. Updated test harness (21/21 pass).
- 🔼 `8ef0ee5` — D.4-A: `annotation-row-mapper.ts` (project AnnotationObject → GeoJSONFeature for DataTable) + 15-test characterization spec. Wired into MapEditor: small-layer DataTable consumes annotations (from existing `annotationPinsQuery` cache, filtered by `activeLayer.id`); large-layer DataTable still reads features via viewportStore.

**F13 Sharing — 3/4 sub-waves shipped:**
- 🔼 `bfed31e` — F13.1 hash-state viewport URL. `viewport-hash.ts` codec (#zoom/lat/lng, 2dp/5dp precision) + `use-share-viewport-hash.svelte.ts` composable (debounced replaceState, hashchange listener, returns stop fn). 20-test codec spec. Wired into ShareViewerScreen via $effect on mapInstance.
- 🔼 `4e2a1b5` — F13.2 dedupe token resolution. New `resolve-share-token.ts` returns discriminated `{kind: 'ok'|'not_found'}`. +page.server.ts and tRPC shares.resolve both consume it. -36 LOC of duplicated SQL.
- 🔼 `737847b` — F13.3 link expiration. Migration `0020_add_share_expires_at.sql`. **Migration applied to dev DB.** `resolveShareToken` returns `kind: 'expired'` discriminant. ShareDialog UI dropdown (None / 1d / 7d / 30d). 8-test resolve-share-token spec including equal-to-now boundary.

**Database smoke test:**
- 🔼 Migration 0019 applied + verified: ALTER TABLE / FK ON DELETE SET NULL / composite index. Test row INSERT/SELECT/cleanup cycle confirms `Index Scan using annotation_objects_map_layer_idx`. 2117 pre-existing annotations have NULL layer_id (expected — predate D-α; user's "no retrofitting" caveat).
- 🔼 Migration 0020 applied + verified: ADD COLUMN expires_at TIMESTAMPTZ NULL.

### Smoke test (still pending — user task, NOW the only Phase 3 gate)

Run migration first: `DATABASE_URL=... pnpm --dir apps/web exec drizzle-kit migrate` (or whatever the project's migrate script is).

Then open MapEditor in dev browser, draw a Point/Line/Polygon. Verify:
1. Row appears in **annotation panel** within ~1s.
2. Row appears in the **DataTable** for that layer (the new D.4-A surface — should show name/description/anchor_type/body columns instead of feature properties).
3. `psql` shows row in `annotation_objects` (NOT `features`); `layer_id` column populated with the active layer's UUID.
4. No visual flash on commit (TerraDraw clears overlay → annotation source paint replaces it without gap).
5. **Per-layer filter:** switch active layers; DataTable shows annotations associated with the *new* active layer only. Annotations drawn on a different layer should not appear.
6. Imported small layers (CSV/GeoJSON without annotations): DataTable empty (expected under D.4-A — imports stay rendered on map but aren't surfaced in DataTable).

## What Worked

- **Sub-wave commits per the plan's "separately revertable" guidance.** Each of A.1/A.2/A.4/B.2/B.3/D.1+D.2/D.3 is a clean revert unit. Made the multi-stage rewrite tractable.
- **Advisor pivots avoided 2 wrong directions.** First reversed my over-engineered A.4 (full `annotationSelected` state variant) → narrow callback. Second reversed my flip-flopping D.4 picks → "stop, hand off, ask user cold."
- **Project rule (`.claude/rules/features-table-write-boundary.md`) over CI lint.** Path-scoped guidance loads when editing the relevant code; doesn't require touching CI config + drizzle build.
- **Schema migration done with no retrofit.** User said "no users, no retrofitting" → no NOT NULL gymnastics needed; nullable layerId is structurally correct anyway (viewport + measurement anchors don't have layers).

## What Didn't Work

- **Initial A.4 default of (b) was wrong.** Read `handleFeatureDrawn` and over-tagged `featureSelected` transition as load-bearing. Advisor correctly framed it as feature-popup-model — annotations follow a panel-model. Final A.4 = option (c) primary + a narrow `onannotationdrawn` callback for the one cross-cutting concern (activity log).
- **Wave D plan as written assumed full feature→annotation unification (Wave C migration).** Wave C was already resolved as "skip migration" before this session. So Wave D's "DataTable shows annotations grouped by layer" presupposed a unification that didn't happen. Caught at decomposition time (commit `50ce980` rescopes D/E/F).
- **D.4 not shipped.** Three plausible UX shapes (annotations-only, features+annotations toggle, mixed combined view) — needs product input. Advisor: "stop pre-recommending, ask cold." Surfaced to user; awaiting decision.

## Key Decisions

- **A.4 = option (c) "remove the broken bridge" + minimal `onannotationdrawn` for activity log.** The visual-flash race the early plan worried about is mitigated by `createAnnotationMutationOptions.onMutate`'s synchronous optimistic `setQueryData` — AnnotationRenderer re-renders before TerraDraw's `removeFeatures` fires. Verified empirically only via tests (21/21 + 0 svelte-check); user smoke-test pending.
- **Wave C already resolved as "skip migration."** Pre-existing decision (before this session) but its implications cascaded into D/E/F revisions.
- **Wave D-α (schema migration) over D-β (dual-source DataTable) or D-γ (do-nothing).** User chose D-α explicitly. Schema migration shipped (D.1-D.3); UI wiring (D.4) deferred for product UX decision.
- **`flagOrphanedAnnotations` left in place but caller-less.** B.3 removed the only caller (`features.delete`). Wave D-α's ON DELETE SET NULL handles layer cascades but NOT feature-anchored annotation cleanup. Open seed `felt-like-it-e5fb` tracks the question of trigger-vs-hook-vs-retire.
- **`convertAnnotationsToLayer` (forward convert) kept.** Live AnnotationPanel surface; plan's "default: drop" pre-dated this session's understanding that the feature is wanted.

## Trajectory

**How we got here.** Resumed `2250bc0` handoff. Wave A.1 (the prior session's stopping point) executed in 4 sub-tasks per the revised plan. After Wave A, user said "continue per plan" — went into Wave B (cleanup). Wave B done, plan ran into its own design hole at Wave D (annotations have no layerId; the plan presumed unification that never happened). Wrote plan amendment exposing the inconsistency and surfaced D-α/D-β/D-γ to user. User picked D-α; ran D.1+D.2+D.3 as schema-and-plumbing. Stopped at D.4 (UI repurpose) when advisor flagged "this is a real UX shape decision, not an implementation choice — ask the user cold."

**Hard calls.** (1) **Stopping at D.4** when the rest of the migration was 80% mechanical and the temptation was to ship a "best guess" UI. The user said "no users, no retrofitting" — which is permission to break compatibility but not permission to invent a UI shape. Advisor caught my third internal pivot on the question and called the stop. (2) **Whether to keep `flagOrphanedAnnotations` (no caller) or delete it.** Kept it because Wave D-α's layer-cascade resolution makes feature-cascade orphan-cleanup MORE relevant, not less; the gap deserves a seed (e5fb) and product input rather than silent deletion.

**Shaky ground.** D.4's UX shape is the highest-uncertainty edge. Three options each break in different ways (clean break loses visibility of import data in DataTable; toggle adds UI complexity; combined view mixes schemas). Without a real user to walk through, every option is a guess. The smoke test for Wave A-through-D.3 also hasn't been run in a real browser — I tested via vitest harness only. If the visual-flash race is in fact a problem, the existing optimistic-cache mitigation should fix it but only the live drawing tools will tell.

**Invisible context.** The user is on a 6-month build cycle, "no users" is literal — pre-product, no retrofitting required. This caveat enabled the clean dispatch flip in A.2 (no feature-flag, no progressive rollout) and the schema migration in D.1 (no backfill). The user has been treating my output more skeptically than past sessions (caught me three times mid-thinking), correctly so.

## Active Skills & Routing

- **check-handoff** at session start (resumed `2250bc0`).
- **mulch + seeds** throughout — 3 mulch records added (sveltekit conventions + activityStore + void-suppression pattern), 1 mulch sync auto-committed (`d9cffce`), 1 seed opened (`felt-like-it-e5fb`).
- **advisor** invoked 3 times (A.4 design, A.4 implementation reconcile, D.4 stop-or-continue). Each call materially changed direction.
- **No /triage, no /handoff, no /shadow-walk used.** Pure executing-plans flow with brownfield protocol.
- Next session likely wants: **Decision on D.4** UX shape from user (3 options below). Once chosen, **executing-plans** with subagent or inline-edit for the picked shape.

## Infrastructure Delta

No infrastructure changes this session. No plugin updates, no hooks, no skills, no CI changes. New project rule file (`.claude/rules/features-table-write-boundary.md`) is project-local guidance — not infrastructure.

## Knowledge State

- Indexed: nothing added via `context add` this session. Foxhound not invoked.
- Productive tiers: `ml search` + `grep -rn` + Read for routing. Worked fine.
- Gaps: `flagOrphanedAnnotations` orphan paths not wired (seed `e5fb`); D.4 UX shape (decision pending).
- Mulch: 281+ records; 3 added this session under `sveltekit` domain.

## Next Steps

**F13.4 — lightweight viewer / bundle-split** (next session, ~1-2 sessions):
- ShareViewerScreen currently mounts MapEditor with `readonly={true}`. MapEditor still imports the full editing tree (undo store, drawing toolbar, filter mutation paths, annotation-create mutations).
- Audit ShareViewerScreen's dependency tree first (bundle-analyzer or `rollup-plugin-visualizer`) to size the actual bloat.
- Two implementation paths: (a) gate features inside MapEditor on the existing `readonly` prop — denser refactor but keeps one component; (b) build a parallel `ReadOnlyMapViewer.svelte` that imports a narrower set of components.
- Acceptance: bundle-analyzer shows N% JS reduction on the share route. No regression in viewport / annotations display.

**Phase 3 follow-ups (small, design-y):**
- Decide `e5fb` (`flagOrphanedAnnotations` orphan-flag wiring strategy): postgres trigger on features DELETE / server-side hook at every features-DELETE callsite / retire the concept.
- Revisit `convertAnnotationsToLayer` survival (open question in the unified-annotations-phase-3.md plan).
- Browser smoke test (still pending): UI portion of Phase 3 + F13.1-F13.3 — DataTable shows annotations, hash-URL syncs, expiration UI works end-to-end.

**Next epic options after F13.4:**
- **F14 Embedding** (`felt-like-it-d2d6`, ~1-2 sessions): cooperative gestures + bundle-split for the embed flow. Pairs naturally with F13.4 (both produce read-only viewers; share the bundle-split insight).
- **N01 Cluster, N02 Marker, N03 Data join** — new-flow seeds.

⚠ unverified: real browser smoke for the full session's work. Optimistic `setQueryData`, hash-sync race against `moveend` debounce, expiration UI rendering. **DB layer is verified** (migrations applied + index hit confirmed); **UI layer is not.**

## Context Files

- **`apps/web/docs/plans/unified-annotations-phase-3.md`** — canonical Phase 3 plan with status banner; Wave D rescoped with the three resolution options.
- **`apps/web/src/lib/components/map/DrawingToolbar.svelte`** — saveAsAnnotation now passes `layerId: activeLayer.id` (line ~217 area).
- **`apps/web/src/lib/components/map/MapEditor.svelte:802,814`** — DataTable instantiation sites; Wave D.4 modifies these (or their data plumbing).
- **`apps/web/src/lib/components/data/DataTable.svelte`** — currently fed `features: GeoJSONFeature[]` from the parent; Wave D.4 either replaces the data source or adds a toggle.
- **`apps/web/src/lib/server/annotations/service.ts`** — `list({mapId, layerId?})` is the new query path for D.4's data source.
- **`apps/web/src/routes/api/v1/maps/[mapId]/annotations/+server.ts`** — `?layerId=` query param accepts the filter.
- **`packages/shared-types/src/schemas/annotation-object.ts`** — `AnnotationObject.layerId` and `CreateAnnotationObjectSchema.layerId` are the type contracts.
- **`apps/web/src/lib/server/db/migrations/0019_add_layer_id_to_annotations.sql`** — migration. Run with `DATABASE_URL=... pnpm --dir apps/web exec drizzle-kit migrate` (or whatever the project's migrate script is) before smoke testing.
- **`apps/web/src/__tests__/drawing-save-annotation.test.ts`** — characterization harness; 21 tests covering create + undo + onannotationdrawn + layerId propagation.
- **`.claude/rules/features-table-write-boundary.md`** — Wave B.3 boundary rule; loads when editing `apps/web/src/lib/server/**`.
- **Open seed `felt-like-it-e5fb`** — `flagOrphanedAnnotations` no-caller question.
