# Spike — Path-anchor backfill audit

**Task:** seeds `felt-like-it-f8e0` (Unified-annotations follow-up).
**Question:** Do we backfill existing `measurement`-anchored LineString annotations into the new `path` anchor type, or leave them as-is?
**Time cap:** 30 min.
**Result:** Do nothing. Zero migration candidates today. Re-run the audit before Phase 3 (`baa4`) and re-decide if the count is non-zero.

---

## Context

Unified-annotations rule 1 (see `apps/web/docs/plans/unified-annotations.md`) introduced a `path` anchor type. Pre-rollout, the only way to anchor a free-drawn line on the map was the `measurement` anchor, which was always paired with a measurement-shaped body (`{type: 'measurement', measurementType, value, unit, displayValue}`).

The semantic split going forward:

- **measurement** — a labelled distance/area overlay. Body is `{type: 'measurement', ...}`. Renderer draws the line + the label.
- **path** — a freely drawn line with no measurement semantics. Body is anything else (text/emoji/etc.). Renderer draws just the line.

A row is a **migration candidate** iff it predates the path anchor AND was authored as a free-drawn line (not a measurement). The detection rule:

```
anchor.type = 'measurement'
  AND anchor.geometry.type = 'LineString'
  AND content.body.type != 'measurement'
```

A row that satisfies the first two but has a measurement body is correctly classified — leave it alone.

## Evidence

Query against `felt-like-it-postgres-1` (dev), 2026-04-24:

| Metric | Count |
|--------|-------|
| Total `annotation_objects` rows | 2117 |
| `anchor.type = 'measurement'` | 1 |
| `anchor.type = 'measurement'` AND geometry is `LineString` | 1 |
| **Path candidates** (above + body type ≠ `'measurement'`) | **0** |
| `anchor.type = 'path'` (post-shift) | 0 |

The single measurement-LineString row has a measurement body, which is correct under the new rules.

The dev DB is the same one used for the prior `name`-backfill spike (~2100 fixture/test rows). Production has ~0 real users. There is no data to migrate today.

## The audit query (re-runnable)

```sql
-- Count candidates
SELECT COUNT(*) AS path_candidates
FROM annotation_objects
WHERE anchor->>'type' = 'measurement'
  AND anchor->'geometry'->>'type' = 'LineString'
  AND content->'body'->>'type' IS DISTINCT FROM 'measurement';

-- Inspect candidates (when count > 0)
SELECT id, map_id, name, content->'body'->>'type' AS body_type, anchor->'geometry' AS geometry
FROM annotation_objects
WHERE anchor->>'type' = 'measurement'
  AND anchor->'geometry'->>'type' = 'LineString'
  AND content->'body'->>'type' IS DISTINCT FROM 'measurement'
ORDER BY created_at;
```

## The migration query (only if count > 0 AND decision is "migrate")

```sql
BEGIN;
UPDATE annotation_objects
SET anchor = jsonb_set(anchor, '{type}', '"path"'::jsonb),
    version = version + 1
WHERE anchor->>'type' = 'measurement'
  AND anchor->'geometry'->>'type' = 'LineString'
  AND content->'body'->>'type' IS DISTINCT FROM 'measurement';

-- Inspect before commit
SELECT COUNT(*) AS migrated FROM annotation_objects WHERE anchor->>'type' = 'path';
-- COMMIT or ROLLBACK based on inspection
ROLLBACK;
```

Notes:

- `version + 1` is required so optimistic-concurrency clients invalidate caches.
- The `anchor.geometry` payload stays — only `anchor.type` flips.
- `content` is untouched. Bodies on these rows are not measurement-shaped, so the renderer reads the same body either way; the user-visible change is just the absence of measurement chrome.
- Wrap in a transaction; this is a one-shot migration, not a Drizzle migration file. Run it manually behind a flag or as part of the Phase 3 deployment.

## Options considered

1. **Do nothing.** Audit shows 0 candidates. The schema accepts both anchor types. The renderer handles both.
2. **Run the migration prophylactically.** Future-proof against unknown rows. Risks: renames `measurement` → `path` for any row the audit missed (e.g., one written between audit and deploy).
3. **Schedule the migration as part of `baa4` (Phase 3).** Same UPDATE, but executed as a deploy-time step alongside the feature/annotation collapse. Lowest risk because the audit re-runs at deploy time.

## Decision

**Option 1 (do nothing) for now, fold into Option 3 if Phase 3 ships.**

Rationale:
- Zero candidates today. Migrating zero rows is wasted churn.
- The renderer's `coalesce` paint pattern (commits `9f0217d`, `a78554a`) means measurement-LineString rows still render as lines — there is no visual regression to chase.
- Any new rows authored before Phase 3 ships will go through the new code paths (TerraDraw commits or convert.ts:350-352), which already use `path`. The leak window is closed.
- If the count is non-zero next time we audit, the UPDATE above is one transaction.

## Recommendation to the plan

- **Seed `felt-like-it-f8e0` closes as `outcome:partial` — audit run, migration deferred.** The audit + UPDATE SQL is preserved here for the next re-run.
- **Phase 3 (`baa4`) plan must include a "re-run audit" gate** before declaring data migration done. If candidates appear, run the UPDATE above first, verify count, then proceed with the rest of the Phase 3 cutover.

## Follow-up

- None tracked as a separate seed. The audit + decision are inputs to `baa4`.
