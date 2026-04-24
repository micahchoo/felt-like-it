# Unified Annotations — Phase 3 (Write-side Unification)

> Dedicated plan for `felt-like-it-baa4` (epic, P3, 2+ sessions). Companion to `unified-annotations.md` Phases 1+2 (shipped). Read those first.

## Status (2026-04-25)

| Wave | State | Notes |
|---|---|---|
| Pre-flight | DONE | Path-anchor backfill audit + product confirmation + DB snapshot all green. |
| A — TerraDraw → annotations | **DONE** | Commits 62b37e4, e25099c, 56869b1, cfdaec0 |
| B — features write lock-down | **DONE** | Commits 3b25ce6, fe4261e + `.claude/rules/features-table-write-boundary.md` |
| C — Migrate existing features | **N/A** | Resolved as "skip migration"; existing rows stay in `features` as import-data |
| D — DataTable repurpose | **BLOCKED on design** | Choose D-α / D-β / D-γ — see Wave D section below |
| E — features endpoint deprecation | **DEPENDS on D** | Likely cancelled if D-γ |
| F — Cleanup | **NOT-PLANNED under current resolution** | Triggers only if product chooses D-α |

**The post-Phase-3 invariant Phase 3 actually shipped:** user-drawn shapes live in `annotation_objects`; non-user data (imports + geoprocessing + cloned layers) lives in `features`. Both tables stay, both REST endpoints stay, the boundary is enforced by the Wave B.3 lint rule. The original "collapse into one table" thesis was softened by Wave C's "skip migration" resolution; Phase 3 redefines rather than unifies the dual model.

## Thesis

Collapse the features/annotations dual model. After Phase 3:

- **TerraDraw tool commits** create rows in `annotation_objects`, **not** `features`.
- The **`features` table is read-only at the application layer** — populated only by import pipelines (GeoJSON/CSV/etc.).
- Existing `features` rows are migrated into `annotation_objects` with appropriate anchors (`point|path|region` per geometry type).
- The DataTable repurposes to read annotations grouped by layer instead of features.
- The `features` table is dropped (or kept as an import-staging area, decision pending in Wave F).

The annotation becomes the **single map-thing primitive** the user manipulates. Imports remain as-is up to the staging point, but converge into annotations the moment they're map-ready.

## Pre-flight gates (mandatory)

Phase 3 starts only when **all three** are true:

1. **Path-anchor backfill audit re-run.** Per `notes/unified-annotations-path-backfill.md`. Run the audit query; if non-zero candidates, run the documented UPDATE inside a transaction. Verify count matches expected. Do NOT proceed to Wave A with stale measurement-LineString rows in the wild.
2. **Product confirmation.** The user has used Phases 1+2 against real workflows for at least one cycle and signals "the direction is right" — this is a costly migration to roll back.
3. **Snapshot.** Database snapshot of `annotation_objects` + `features` + `layers` taken and verified restorable. Migration is destructive; pre-flight backup is non-negotiable.

If any gate fails, defer Phase 3 — do not partially execute.

## Decomposition (7 sub-waves)

```
Pre-flight  ─►  Wave A  ─►  Wave B  ─┐
                                      ├─►  Wave D  ─►  Wave E  ─►  Wave F
                          Wave C  ────┘
```

**Wave A** (TerraDraw rewrite) and **Wave C** (data migration) are independent — can run in parallel sessions if desired. **Wave B** (features lock-down) requires both A and C complete. **Wave D** (DataTable repurpose) requires B. **Waves E** (API deprecation) and **F** (table drop) are sequential, low-risk cleanup.

---

## Wave A — TerraDraw commit → annotation_objects

**Goal.** When the user finishes drawing a point/line/polygon via the TerraDraw toolbar, the commit handler creates an `annotation_objects` row, not a `features` row.

**Actual scope (revised 2026-04-24 after exploration of the existing path):**

The original "1 line in `MapCanvas.svelte`" estimate was wrong. The TerraDraw commit handler lives in `apps/web/src/lib/components/map/DrawingToolbar.svelte:99-131` (`draw.on('finish', ...)`) — not MapCanvas. Its `saveFeature(f)` helper (lines 170-244) does FOUR jobs that all need annotation-equivalents:

1. **Mutation:** `featureUpsertMutation` → must become `createAnnotationMutation` (helper exists at `apps/web/src/lib/components/annotations/AnnotationMutations.ts:46-101`).
2. **Optimistic UI:** `hotOverlay.addHotFeature(layerId, ...)` (a global features-layer optimistic store) → must become tanstack query-cache optimism (the existing annotation pattern). These are two different mechanisms.
3. **Undo/redo:** `undoStore.push({ undo: deleteFeature, redo: createFeature })` → must use `deleteAnnotationMutation` (exists in same helpers file).
4. **Parent callback:** `onfeaturedrawn?.(layerId, {geometry, properties, id})` flows up through MapCanvas → MapEditor and triggers features-list refetch. If we silently drop it, parent's features list goes stale.

**Plus:** `apps/web/src/__tests__/drawing-save.test.ts` is a long-form vitest characterization spec for the existing `saveFeature` flow. Flipping the persistence target either (a) breaks these tests and they need rewriting, or (b) requires saveFeature to remain coexisting alongside a new saveAsAnnotation, which is the safer rollout but creates dead-code-pending-Wave-B.

**Anchor mapping** (per Phase 1 rule 1, already in `convert.ts:344-352`):
- `Point` → `{type: 'point', geometry}`
- `LineString` → `{type: 'path', geometry}`
- `Polygon` → `{type: 'region', geometry}`
- Other geometry types → reject at the TerraDraw config level (don't even surface a tool).

### Wave A decomposed into 4 sub-tasks

- **A.1** — In `DrawingToolbar.svelte`, ADD a parallel `saveAsAnnotation(f)` function (don't remove `saveFeature` yet). Wire `createAnnotationMutation` + anchor derivation. Wire annotation-store optimistic add. Wire undo via `deleteAnnotationMutation`. ~80-120 LOC added; saveFeature unchanged. Tests: add new vitest section for saveAsAnnotation (mirrors drawing-save.test.ts shape).
- **A.2** — Switch the dispatch in `draw.on('finish')` to call `saveAsAnnotation(f)` instead of `saveFeature(f)`. The two CTA paths (`onregiondrawn`, `onmeasured`) are unchanged. saveFeature becomes unreachable but kept until Wave B.
- **A.3** — Update `drawing-save.test.ts`: either rewrite to assert annotation-create OR add a parallel `drawing-save-annotation.test.ts` and mark the original as `.skip()` with a rename PR. Tests of `onfeaturedrawn`-callback-not-called become tests of `onannotationdrawn`-was-called (or the callback prop is removed in Wave B).
- **A.4** — `onfeaturedrawn` chain: trace MapEditor consumer; it likely refetches features. Decide: (a) keep the callback firing for backward-compat (parent re-fetch is wasted but harmless); (b) replace with `onannotationdrawn` and update MapEditor; (c) remove entirely and let annotation cache invalidation handle parent updates. **Resolved (2026-04-25): (c) primary + a narrow (b)-shaped callback for activity logging only.** Earlier (2026-04-25 morning) this slot read "default (b)" based on a trace of `handleFeatureDrawn` (`MapEditor.svelte:262-290`) which does three things: layer refetch, `featureSelected` state transition, and activity log. The reasoning was:
  1. **`loadLayerData` re-fetch** — covered by `createAnnotationMutationOptions.onSuccess` invalidating `queryKeys.annotations.list({mapId})`. ✅
  2. **`transitionTo({type: 'featureSelected', ...})`** — was tagged "load-bearing UX." But on review (advisor reconcile) this is the **feature-popup model** — inspection via FeatureState highlight + popup. **Annotations follow a panel model**: the new row appears in `AnnotationPanel` via cache invalidation; naming and editing happen by clicking the panel row, not via popup. There is no annotation-equivalent of `featureSelected` to transition to, and forcing a feature-shaped selection state with an annotation id was the broken-on-arrival contract that A.2's "bridge" introduced. → Drop this responsibility entirely; let the panel auto-refresh do the work.
  3. **`activityStore.log('feature.drawn', ...)`** — observability event; needs an annotation-equivalent. ActivityStore is an instance owned by `MapEditor`, so DrawingToolbar can't log directly without either context plumbing (over-scope for A.4) or a narrow callback.
  
  **Implementation:** introduce `onannotationdrawn?: (a: { id: string; anchorType: Anchor['type'] }) => void` on DrawingToolbar (pass-through MapCanvas). MapEditor wires `handleAnnotationDrawn` that fires `activityStore.log('annotation.drawn', {annotationId, anchorType})` and nothing else. The bridge `await onfeaturedrawn?.(...)` call in `saveAsAnnotation` is removed — its visual-flash mitigation rationale was superseded by `createAnnotationMutationOptions.onMutate`'s optimistic `setQueryData`, which writes the new row into the cache **synchronously before the mutation network round-trip**, so the annotation source re-renders ahead of TerraDraw's `removeFeatures`.
  
  `onfeaturedrawn` + `handleFeatureDrawn` + `saveFeature` remain as dead code until Wave B's lock-down pass deletes them in one stroke.

Each sub-task ends with `pnpm exec svelte-check` + relevant vitest run + visual smoke test in the dev browser. Sub-task commits are separately revertable.

**Acceptance:**
- Drawing a point via TerraDraw produces a row in `annotation_objects`, NOT `features`. Verify via `psql` and via the annotation panel showing the new row.
- e2e: Playwright test that opens MapEditor, clicks the Point tool, clicks the canvas, asserts the annotation appears in the panel within 1s.
- Old `featureUpsertMutation` is unused after A.2; physically removed in Wave B.
- `drawing-save.test.ts` either updated or replaced; tests pass.

**Risk.** TerraDraw also has an in-memory representation — `editorState.drawingInstance.removeFeatures([id])` clears it after the persist completes. The clear timing matters: if the annotation source GeoJSON hasn't loaded the new pin by the time TerraDraw clears its overlay, the user sees the pin disappear and re-appear (visual flash). Keep the existing `await onfeaturedrawn?.(...)` await pattern on the new annotation path until A.4 is decided.

**Size:** **4 sub-sessions**, NOT 1. Roughly 1 morning per A.1/A.2 (code + tests), 1 afternoon for A.3 + A.4 together.

**Pre-work for next session:** trace what `onfeaturedrawn` does in MapEditor.svelte specifically — what state it triggers, whether removing it breaks any user-visible behavior. That's the highest-uncertainty edge of A.4.

---

## Wave B — `features` table application-write lock-down

**Goal.** No application code path writes to `features` outside the import pipeline.

**Approach:** grep for `INSERT INTO features` / `UPDATE features` / `DELETE FROM features` across `apps/web/src/lib/server/`. For each callsite outside `lib/server/imports/`:

- If TerraDraw or annotation-related: should already be migrated by Wave A → assert it is.
- If layer/import-related: leave alone (whitelist).
- If unknown: investigate, decide migrate vs. preserve.

Add an ESLint rule (or a CI check) that bans `INSERT INTO features` outside `apps/web/src/lib/server/imports/**` — boundary becomes load-bearing per CLAUDE.md "Negative rules".

**Acceptance:**
- `grep -r 'features' apps/web/src/lib/server | grep -E '(INSERT|UPDATE|DELETE)'` returns only import-pipeline matches.
- ESLint rule fires on a deliberate violation in a test file.

**Risk.** Convert helpers (forward direction) currently INSERT to features. Decide: keep forward-convert (annotation → layer), or remove (Phase 3 collapses the distinction so forward-convert becomes meaningless). Default: **remove** — the test specs already passed via the partial Wave 3 close-out, but the function itself becomes dead code in Phase 3.

**Size:** 1 session (mostly grep + delete).

---

## Wave C — Data migration: existing `features` → `annotation_objects`

**Goal.** Every existing `features` row that represents a user-created map-thing (not an import-source row) is migrated into `annotation_objects`.

**Critical decision: which features rows migrate.**

`features` was historically used as a property bag for imports too. Not every row is a user-created annotation. Migration must distinguish.

**Discriminator candidates:**
- Rows whose `properties` contain a key indicating user origin (e.g., `created_via: 'terradraw'`).
- Rows on layers with `type IN ('drawing', 'sketch')` vs `type IN ('imported', 'csv', 'geojson')`.
- Rows with no `import_id` linkage (assuming an `imports` table joins them).

**Pre-flight audit run 2026-04-24 (felt-like-it-postgres-1):**

```
layer.type | feature_rows
mixed      | 10019
polygon    |    11
```

Only two `layer.type` values exist; neither distinguishes user-drew from imported. The `layer.type IN (drawing, sketch)` discriminator from the candidate list **does not work** — no such layers exist. **Wave C cannot proceed with the original discriminator.** Alternative paths to investigate at execution time:

1. `features.properties` shape — grep a sample of rows; if importer pipelines stamp a recognizable key (e.g., `import_id`, `source_file`), use the absence of those as the user-origin signal.
2. `features.created_at` clusters — imports tend to be batched (1000s of rows in a single second); user draws are singletons. Histogram of insertion-rate-per-minute may separate the populations.
3. **Default if no clean discriminator emerges: skip migration entirely** — keep `features` as the imported layer's home and mark all 10K existing rows as "imports". Only new TerraDraw commits go into annotation_objects. Old TerraDraw drawings are accepted-loss (or migrated lazily on user touch).

**Discriminator investigation run 2026-04-24:**

```
-- Top property keys (10009 rows have 'name' / 'category' / 'value' shape)
key      | count
name     | 10009
category | 10005
value    | 10000
mode     |    14
idx      |     6
tenant   |     6
...

-- created_at clustering (one giant batch + scattered singletons)
2026-03-20 05:27:00 | 10000  ← single seed-script run (synthetic)
2026-04-24 18:12:00 |     9
2026-03-20 05:13:00 |     5
(other minutes)     |     1-2

-- Singletons vs batches summary
minutes with 1 row: 14
minutes with 2-9:    3
minutes with ≥10:    1   (the 10K seed)
```

**Conclusion: no clean structural discriminator.** The 10K-row batch is identifiable as synthetic seed data via property shape (`{name: F-XXXX, category: A/B/C, value: num}`), but production imports of real CSV data would have unknown property shapes and would also be batched. Property-shape and clustering both work for THIS dev DB but don't generalize.

**Going with Option 3** (no migration of existing rows). Migration semantics:

- `annotation_objects` gets all NEW TerraDraw commits going forward (Wave A).
- The 10K existing `features` rows stay in `features` and are treated as "imported" by the application — DataTable in Wave D reads them via the legacy features endpoint OR via a unified `/api/v1/maps/:mapId/things` endpoint that joins the two tables for read-only display.
- Old TerraDraw drawings (if any exist in `features`) are accepted-loss — the user re-draws them if they want them as annotations.
- The 10K-row seed-script batch is not user content — losing them is fine even if "loss" doesn't apply.

Audit query template (re-run before Wave C if user wants to revisit migration):

```sql
SELECT l.type, COUNT(*) AS rows
FROM features f JOIN layers l ON l.id = f.layer_id
GROUP BY l.type
ORDER BY rows DESC;
-- Sample properties shape for discriminator hints
SELECT properties FROM features TABLESAMPLE BERNOULLI (0.5) LIMIT 20;
```

**Migration query template** (per geometry type):

```sql
BEGIN;
INSERT INTO annotation_objects (id, map_id, user_id, anchor, content, name, version, created_at, updated_at)
SELECT
  f.id,
  l.map_id,
  l.created_by AS user_id,
  jsonb_build_object(
    'type', CASE GeometryType(f.geometry)
      WHEN 'POINT' THEN 'point'
      WHEN 'LINESTRING' THEN 'path'
      WHEN 'POLYGON' THEN 'region'
    END,
    'geometry', ST_AsGeoJSON(f.geometry)::jsonb
  ) AS anchor,
  jsonb_build_object('kind', 'single', 'body', jsonb_build_object('type', 'text', 'text', COALESCE(f.properties->>'name', 'Untitled'))) AS content,
  COALESCE(f.properties->>'name', NULL) AS name,
  1 AS version,
  COALESCE(f.created_at, NOW()),
  NOW()
FROM features f JOIN layers l ON l.id = f.layer_id
WHERE l.type = '<DISCRIMINATOR>' /* per pre-flight */
  AND GeometryType(f.geometry) IN ('POINT', 'LINESTRING', 'POLYGON')
ON CONFLICT (id) DO NOTHING;
-- Inspect counts before commit
SELECT COUNT(*) AS migrated FROM annotation_objects WHERE created_at >= NOW() - interval '5 minutes';
ROLLBACK;
```

Wrap in transaction; review counts; commit only if matches expectation. Do NOT delete the source `features` rows in this wave — Wave F handles that.

**Acceptance:**
- Migration count matches the pre-flight discriminator count.
- Spot-check 10 random migrated rows: anchor type matches geometry, name preserved.
- Original `features` rows still exist (deletion deferred).
- `annotation_objects` count increases by exactly the migration count.

**Risk.** ID collision (a feature ID equals an existing annotation ID) → `ON CONFLICT DO NOTHING` masks this. Run a pre-flight `SELECT COUNT(*) FROM features f JOIN annotation_objects a ON f.id = a.id` first; if non-zero, decide policy (rename or skip).

**Size:** 1 session for query authoring + dry-run; data verification is open-ended.

---

## Wave D — DataTable repurpose ⚠ BLOCKED ON DESIGN

**Status (2026-04-25, post-Wave-B):** the original Wave D thesis ("DataTable reads annotation_objects filtered by layer") presupposed Wave C migrating existing features into annotations. Wave C was **resolved as "skip migration"** — imports + geoprocessing keep writing to `features`, only NEW user-draws go to annotations. The two tables now coexist permanently. This invalidates Wave D's stated goal and surfaces blockers below before any code is written.

**Open Questions (Wave D rescope):**

1. **Annotations have no layerId.** `annotation_objects` is map-scoped (`mapId`, no `layer_id`). `annotationService.list({mapId})` cannot filter by layer. Three resolutions:
   - **D-α: schema migration.** Add `layer_id uuid NULL REFERENCES layers(id) ON DELETE SET NULL` to `annotation_objects`. Then annotations CAN be layer-scoped (optionally), and DataTable's "view this layer's data" gesture transfers cleanly. Cost: migration + service-layer plumbing + decision about back-fill (existing rows get NULL).
   - **D-β: dual-source DataTable.** DataTable shows TWO sections — Layer Features (still from `features`, unchanged) AND Annotations (from `annotation_objects`, map-scoped). The "this layer's data" semantics persist for features only; annotations are a sibling concern. Cost: 2x the rendering, more complex empty-state.
   - **D-γ: redirect the DataTable's purpose.** DataTable becomes a layer-data viewer only (features). Annotations get their own surface in the AnnotationPanel (which they already have). DataTable doesn't need to know about annotations. Cost: zero — accept that DataTable and AnnotationPanel are separate views.
   
   **Recommendation: D-γ** (do nothing) is the minimum path, matches user's existing mental model (panel for annotations, DataTable for layer data), and avoids schema churn. D-α is the "right" long-term answer if annotations become heavily layer-organized in product. D-β is the worst of both — UI complexity without payoff.

2. **What grouping does product want for annotations?** If annotations cluster, the natural axis is `annotation_groups` (already in schema), not layers. AnnotationPanel already supports group-by-group display (2026-04-24 commit). Pursuing layer-grouping would require D-α and reinvent what groups already do.

3. **DataTable's role going forward.** Given that imports/geoprocessing/clones legitimately write to `features` indefinitely (per the resolved Wave C decision), `features` is not a "legacy table being phased out" — it's a permanent first-class table for non-user-drawn data. DataTable's purpose ("show this layer's data") remains coherent in the new model with no change. **The premise that DataTable needs repurposing dissolves once you accept Wave C's resolution.**

**Decision required from product:** which of D-α / D-β / D-γ aligns with the eventual annotation UX? Until then, Wave D is on hold — no code change is the safest action.

**Size:** 1 session if D-α (schema + service + UI); 0 if D-γ (do-nothing); ~1 day if D-β (dual-source DataTable).

---

## Wave E — `/api/features` deprecation ⚠ DEPENDS ON WAVE D RESOLUTION

**Status (2026-04-25, post-Wave-B):** Wave C's "skip migration" resolution + Wave D's open status changes the deprecation story. The original draft assumed `/api/v1/maps/:mapId/annotations` was a successor for layer-scoped feature reads — it isn't (annotations are map-scoped, no layerId). And under D-γ ("DataTable does not change"), the features endpoints aren't deprecated at all — they remain the canonical read path for imports + geoprocessing + cloned-layer data.

**Outcome map:**

- If **D-γ** (no DataTable change): Wave E is **cancelled**. The features endpoints are not deprecated. Mention this in the close reason and move on.
- If **D-α** (schema migration adds layer_id): Wave E proceeds with successor URL `/api/v1/maps/:mapId/annotations?layerId=...` once that filter is implemented in `annotationService.list`. Sunset window 90 days.
- If **D-β** (dual-source DataTable): Wave E partially proceeds — only the WRITE endpoints would deprecate (already done — `features.upsert` / `features.delete` removed in Wave B.3). Read endpoints stay forever. No Sunset header needed.

**No-regrets prep (safe to do regardless of D resolution):**
- The internal-only writers `features.upsert` + `features.delete` are already gone (Wave B.3). No external API consumers existed for them — they were tRPC procs, not REST.
- The /api/v1/maps/:mapId/layers/:layerId/features endpoint (REST) does NOT have a write path — only GET. So there is nothing to deprecate write-wise externally. Read deprecation is conditional on D-α landing.

**Size:** depends on D resolution; 0 hours under D-γ.

---

## Wave F — Cleanup ⚠ DEPENDS ON WAVE D/E RESOLUTION

**Status (2026-04-25, post-Wave-B):** Wave F's original list assumed full unification (DataTable migrated, features endpoints sunsetted). Under the resolved Wave C ("skip migration") + recommended Wave D-γ ("do nothing"), Wave F shrinks to:

- ~~Drop `/api/v1/maps/:mapId/layers/:layerId/features` endpoints~~ — KEEP (still serves imports + geoprocessing + cloned-layer reads).
- ~~Drop `features` table~~ — KEEP.
- ~~Drop `featuresStore` and feature-only Svelte components~~ — KEEP (DataTable doesn't migrate under D-γ).
- **Forward-convert (`convertAnnotationsToLayer`)** — open question. Live user-facing flow in AnnotationPanel; promotes annotations → new layer of features. Plan default of "drop in Wave B" deferred. If it stays, Wave F has nothing to drop here either.
- ~~Migration to drop features table~~ — N/A.

**Phase 3 redefines, not collapses, the dual model.** The post-Phase-3 invariant is "user-drawn shapes live in `annotation_objects`; non-user data lives in `features`" — both tables stay, both endpoints stay, the boundary between them is enforced by the Wave B.3 lint rule.

If product ever decides to fully unify (D-α path), Wave F becomes meaningful again. Until then, Wave F is **NOT-PLANNED**.

**Size:** 0 sessions under current resolution.

---

## Open questions

1. **Discriminator for Wave C migration.** Which `layers.type` (or other field) marks "user-drew this" vs "imported from a file"? Audit query in Wave C surfaces the candidate values; user picks before migration runs.
2. **Forward-convert (annotation → layer) survival.** With unified storage, is there still a use case? Default: drop in Wave B.
3. **Features table drop vs keep-as-staging.** If imports stage in `features` then promote to `annotation_objects`, the table survives but is application-write-locked. Default: keep as staging, simpler than re-architecting imports.
4. **`/api/features` external consumers.** Are there any? If zero, Wave E shrinks to a same-day removal instead of a 90-day deprecation.

## Risks

- **Data loss during Wave C.** Mitigated by snapshot pre-flight + transaction-wrapped migration + delayed source deletion (Wave F).
- **Convert spec regression.** The Wave 3 specs (annotation-convert.spec.ts) test forward + reverse convert. If convert is dropped in Wave B, those specs need pruning. Don't surprise the test suite.
- **TerraDraw store divergence.** Wave A risk — if TerraDraw's in-memory store and annotation_objects diverge during the transition, users see ghost geometries. Acceptance test must verify.
- **Phase 3 only when product confirms.** This plan can sit unstarted indefinitely. That's correct — premature execution is the bigger risk.

## Out of scope

- Real-time collaboration (`felt-like-it-660a` blocked seed).
- F09-F14 / N01-N03 flow audits — separate discovery cycle.
- OpenAPI/SDK (`d40a`) — independent strategic work, can run in parallel cycles.

## Success looks like

When Phase 3 completes:
- A user draws a polygon → it appears in the annotation panel with name, description, comments, style, all the Phase 1+2 affordances. There is no separate "feature" path.
- Importing a CSV creates feature rows that auto-promote to annotations on the map (or are read-only feature staging — TBD per open question 3).
- The DataTable shows annotations.
- `grep -r 'features' apps/web/src/lib/server/annotations` returns nothing.
- Phase 3 close commit references the post-implementation audit hitting N/N.
