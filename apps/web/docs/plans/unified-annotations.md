# Unified Annotations — Features Are Annotations

> **Draft.** Strategy document capturing the product shift surfaced 2026-04-24. Not yet decomposed into executable tasks beyond Phase 1.

## Problem

The product today has two parallel object models:

- **Layer features** — geometry + properties, drawn via TerraDraw, live in `features` table, shown in DataTable and on map through `MapCanvas`/MapLibre GeoJSON sources.
- **Annotations** — first-class notes with anchors (`point`, `region`, `feature`, `measurement`, `viewport`), lives in `annotation_objects` table, shown in the annotation panel.

A feature is not an annotation and an annotation is not (usually) a feature. The models diverged because annotations were added later as a "commenting" layer over features. But in practice:

- Users who draw a shape expect it to carry a name, description, style, and the ability to accept comments — i.e. **they expect an annotation**, not a shape-with-schemaless-properties.
- The reverse-convert flow shipped in this session produced garbage names (`From layer feature <uuid>`) because each feature has no first-class label — the annotation's `name` is generated from nothing.
- The feature popup's "Edit Attributes" button leads nowhere because attribute editing is a DataTable flow, but the user clicking a feature on the map is in spatial-reading mode, not spreadsheet mode.

## The shift

**Every drawn thing is an annotation from the moment it exists.** A TerraDraw commit creates an annotation row directly, not a feature. A layer becomes a bag of annotations. The annotation panel is the single entry point for everything on the map. Feature-anchor annotations remain available for stacking multiple annotations on one underlying geometry (e.g., a drawn parcel → one annotation with the shape, plus a sibling emoji annotation, plus a sibling note annotation, all `anchor.type === 'feature'` pointing at the same geometry-carrying annotation).

### Rules

| # | Rule | Source |
|---|---|---|
| 1 | Anchor mapping: point→`point`, line→`path` (new), polygon→`region` | user, 2 |
| 2 | Default scope for feature→annotation conversion is selected features only | user, 3 |
| 3 | Feature-click popup opens the annotation panel at the matching row; no separate Edit Attributes button | user, 4 |
| 4 | TerraDraw commit creates an annotation (not a feature). Multiple annotations can stack on the same geometry via `anchor: {type: 'feature', annotationId: X}` (replaces today's `featureId`) | user, 1+5 |
| 5 | Naming: `properties.name ?? properties.title ?? firstStringProp ?? "Untitled from {layerName}"`. Renamable inline. | user, 1 |

## Phases

### Phase 1 — Micro-fixes (this session)

Keeps the dual model intact but removes the sharpest UX edges so the direction is visible without committing to the migration yet.

1. Naming at reverse-convert — replace `From layer feature <uuid>` with the rule-5 cascade. Server-side in `annotations/convert.ts`.
2. Scope at reverse-convert — if `mapEditorState.hasSelection`, convert only those feature ids. Otherwise, prompt "No selection — convert all N features?" and require an explicit yes.
3. Add `path` to `Anchor` schema. Map line geometries to `path` in convert. Renderer path-layer wiring lives in Phase 2.
4. Open seeds for the deferred items:
   - `path` renderer layer (Phase 2 Task 1)
   - Feature popup routes to annotation panel (Phase 2 Task 2)
   - TerraDraw commit writes annotation directly (Phase 3)

### Phase 2 — Read-side unification (1 session)

The annotation panel becomes the spatial sidebar. Feature click → annotation panel highlight/scroll. No Edit Attributes button; attribute editing moves to the inline annotation editor. `path`-anchored annotations render as styled lines through a new path layer in `AnnotationRenderer`.

Risks: MapEditor click routing currently splits between feature-popup and annotation-popup. Merging them means rewriting the map click handler. Selection state needs to flow from annotation list → map hover-highlight cleanly.

### Phase 3 — Write-side unification (2+ sessions, needs migration)

TerraDraw commits produce annotation rows. The `features` table becomes read-only, populated only by import pipelines. Long-term: migrate the features table rows into annotation rows (`anchor: {type: 'region'|'path'|'point', geometry, layerId}`) and drop the `features` table. DataTable reads annotations grouped by layer.

This is expensive (migration, rewrite of TerraDraw commit handler, deprecation of /api/features, data-model changes). Not in scope until Phase 1+2 land and the product-side confirms the direction survives real use.

## Related seeds

- `felt-like-it-8dd2` — Edit Attributes popup button is unwired (closes in Phase 2)
- `felt-like-it-c07b` — Drag-to-move feature architectural gap (relates: in Phase 3 drag-to-move edits an annotation, not a feature)
- `felt-like-it-6d53` — Select-tool tooltip overpromises "take actions" (closes in Phase 2)
- `felt-like-it-2b5c` — Per-annotation dash not supported (independent of unification)

## Open questions

- **Styling inheritance.** If a layer has a default style, and a feature-annotation on it also has per-annotation style, which wins? Felt's model is: annotation style overrides layer style, layer style overrides basemap. Open for confirmation.
- **`feature` anchor semantics post-unification.** Currently `anchor: {type: 'feature', featureId, layerId}` refers to a row in `features`. After unification, should `feature` anchor refer to another annotation's id (an annotation-that-is-a-feature)? Yes per rule 4, but schema + migration need care.
- **DataTable.** Does DataTable go away, get repurposed as "annotation table view," or stay as a layer-features read-only view? Leaning toward repurpose.

## Not doing

- Real-time collaboration on annotation edits (existing seed `660a` — orthogonal).
- Commenting refactor (seeds `b5c4`, `ed12` — orthogonal).
