-- Felt-parity Wave 2 Task 3.1 — per-annotation style payload.
-- Bible §4 Styling. jsonb so the style shape can evolve without migrations.
-- Renderer falls back to current hard-coded paint when style IS NULL.
--
-- Down:
--   ALTER TABLE annotation_objects DROP COLUMN IF EXISTS style;

ALTER TABLE annotation_objects
  ADD COLUMN IF NOT EXISTS style jsonb;
