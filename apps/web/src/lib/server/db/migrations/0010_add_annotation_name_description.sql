-- Felt-parity Wave 1 Task 1.1 — first-class name + description on annotations.
-- Additive-first: both columns NULLABLE. Legacy rows stay NULL; UI falls back
-- to `content.body.text` preview when `name IS NULL`. A separate backfill
-- task (see plan 1.5 spike) will decide whether to synthesize names for
-- existing text-content rows before we tighten to NOT NULL.
--
-- Down migration (if rolling back):
--   ALTER TABLE annotation_objects DROP COLUMN IF EXISTS description;
--   ALTER TABLE annotation_objects DROP COLUMN IF EXISTS name;

ALTER TABLE annotation_objects
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS description text;

-- Length constraints mirror the Zod schema; DB enforces at write time so
-- direct-SQL writes (e.g. conversion from layer features) also respect them.
ALTER TABLE annotation_objects
  ADD CONSTRAINT annotation_objects_name_length
    CHECK (name IS NULL OR (char_length(name) BETWEEN 1 AND 200));

ALTER TABLE annotation_objects
  ADD CONSTRAINT annotation_objects_description_length
    CHECK (description IS NULL OR char_length(description) <= 5000);
