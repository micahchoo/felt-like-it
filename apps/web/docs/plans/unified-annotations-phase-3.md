# Unified Annotations — Phase 3 (Write-side Unification)

> Dedicated plan for `felt-like-it-baa4` (epic, P3, 2+ sessions). Companion to `unified-annotations.md` Phases 1+2 (shipped). Read those first.

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

**Files (start here):**
- `apps/web/src/lib/components/map/MapCanvas.svelte` — TerraDraw `on('finish')` handler currently calls `featuresStore.add()`. Re-route to `annotationsService.create()` with anchor derived from geometry type.
- `apps/web/src/lib/stores/annotation-geo.svelte.ts` — likely needs a `createFromDraw(geometry, layerId)` helper.
- `apps/web/src/lib/server/annotations/service.ts` — verify `create()` accepts the shape (already does for path/region/point).

**Anchor mapping** (per Phase 1 rule 1, already in `convert.ts:344-352`):
- `Point` → `{type: 'point', geometry}`
- `LineString` → `{type: 'path', geometry}`
- `Polygon` → `{type: 'region', geometry}`
- Other geometry types → reject at the TerraDraw config level (don't even surface a tool).

**Acceptance:**
- Drawing a point via TerraDraw produces a row in `annotation_objects`, NOT `features`. Verify via `psql` and via the annotation panel showing the new row.
- e2e: Playwright test that opens MapEditor, clicks the Point tool, clicks the canvas, asserts the annotation appears in the panel within 1s.
- Old `featuresStore.add()` callsites in TerraDraw paths are removed. Import-pipeline callsites stay.

**Risk.** TerraDraw also has an in-memory representation. Make sure the commit cleanly removes from TerraDraw's store after persisting to annotation_objects, otherwise the user sees a duplicate.

**Size:** 1 session.

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

Audit query template (re-run before Wave C):

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

## Wave D — DataTable repurpose

**Goal.** The DataTable component (currently reads `features`) reads `annotation_objects` filtered by layer.

**Files:**
- `apps/web/src/lib/components/data/DataTable.svelte` — query source flips to `annotationsService.list({ mapId, layerId })`.
- `apps/web/src/routes/api/v1/maps/[mapId]/layers/[layerId]/features/+server.ts` — likely deprecated (`Wave E`); DataTable should call the annotations endpoint with a layer filter.
- Annotations service: confirm `list()` supports `layerId` filter (may need add).

**Acceptance:**
- DataTable opens, displays annotations grouped by layer, columns reflect annotation fields (name, body, anchor type) instead of feature properties.
- Data flow: API call to `/api/v1/maps/:mapId/annotations?layerId=...` returns the rows DataTable displays.
- e2e: open data table on a layer with 5 annotations, assert 5 rows visible.

**Risk.** Existing UI users may have muscle memory for property-bag display. Annotations carry less freeform property data. Consider: surface `content.body.text` + `name` + anchor-type by default, hide internal fields.

**Size:** 1 session.

---

## Wave E — `/api/features` deprecation

**Goal.** External clients (research-narratives etc.) are warned the features endpoints are deprecated; redirected to `/api/v1/maps/:mapId/annotations`.

**Approach:**
- Add `Sunset` header (RFC 8594) to features endpoints with date 90 days out.
- Add `Deprecation: true` header.
- Add `Link: </api/v1/maps/:mapId/annotations>; rel="successor-version"` header.
- Update OpenAPI spec (when `felt-like-it-d40a` lands) to mark endpoints deprecated.
- Email any known external API consumers.

**Acceptance:**
- Curl response on a features endpoint includes the three headers.
- 90-day timer documented in close reason; future cleanup wave drops the endpoints.

**Size:** small, 1-2 hours.

---

## Wave F — Cleanup

After 90-day Sunset window:

- Drop `/api/v1/maps/:mapId/layers/:layerId/features` endpoints.
- Decide: drop `features` table or keep as import-staging.
- Drop `featuresStore` and feature-only Svelte components (DataTable having migrated to annotations).
- Drop `convertAnnotationsToLayer` / `convertLayerFeaturesToAnnotations` if both directions become identity transforms.
- Migration `0020_drop_features_table.sql` (if dropping).

**Acceptance:**
- `grep -r 'features' apps/web/src` returns only import-staging matches (or zero, if dropping).
- Tests still green.

**Size:** 1 session.

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
