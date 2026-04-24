-- Phase 3 Wave D-α (2026-04-25): associate annotations with their parent
-- layer so DataTable can read annotations filtered by layer in the unified
-- model. Nullable — pre-existing annotations have no layer association
-- (created before D-α; surfaced in the panel as "ungrouped"). Future-proofs
-- the "promote/move annotation between layers" UX.
--
-- ON DELETE SET NULL: dropping a layer should NOT cascade-delete its
-- annotations (the user-drawn shape may still be meaningful even after the
-- layer that organized it is gone — the annotation can be re-assigned or
-- live ungrouped). This matches how annotation_groups (group_id) handles
-- the same situation.

ALTER TABLE annotation_objects
  ADD COLUMN layer_id UUID REFERENCES layers(id) ON DELETE SET NULL;

-- Index supports `WHERE map_id = ? AND layer_id = ?` filter pattern used by
-- DataTable's per-layer view and annotationService.list({mapId, layerId}).
CREATE INDEX annotation_objects_map_layer_idx
  ON annotation_objects (map_id, layer_id);
