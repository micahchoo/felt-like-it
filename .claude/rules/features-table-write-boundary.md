---
scope:
  - apps/web/src/lib/server/**/*.ts
  - apps/web/src/lib/server/**/*.sql
tags: [phase-3, write-boundary, annotations]
priority: high
source: hand-written
---

`features` table is application-write-locked outside the import / data-management boundary (Phase 3 unified-annotations).

User-drawn shapes go to `annotation_objects` (TerraDraw → `saveAsAnnotation` in DrawingToolbar). The `features` table is populated only by:

1. **Import pipelines** — `lib/server/imports/**` (GeoJSON / CSV / shapefile / GPKG / WKT) via `geo/queries.ts` helpers (`insertFeatures`, `insertWkbFeatures`, `clearLayerFeatures`).
2. **Geoprocessing** — `lib/server/geo/geoprocessing.ts` writes computed-derived layers (buffer, intersect, etc.). Output is a new layer, not an edit to user-drawn data.
3. **Layer cloning** — `lib/server/maps/operations.ts` duplicates feature rows when cloning a layer.
4. **Annotation forward-convert** — `lib/server/annotations/convert.ts:convertAnnotationsToLayer` promotes annotations into a new layer of features. Status as of 2026-04-25: kept (live user-facing flow); plan default of "remove in Phase 3" deferred — see `apps/web/docs/plans/unified-annotations-phase-3.md` Open Questions.

**Do NOT add new `INSERT INTO features` / `UPDATE features` / `DELETE FROM features` callsites outside that whitelist.** If user input drives the write, it belongs in `annotation_objects` instead.

If you need a new write callsite, ask first — the boundary is load-bearing for the unified-annotations migration. Adding outside the whitelist regresses Phase 3.
