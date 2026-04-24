-- Felt-parity Wave 2 Task 2.1 — annotation_groups folder/organization primitive.
-- Bible §3: groups are the Sidebar List's primary organizing primitive.
-- Additive-first: annotation_objects.group_id is NULLABLE so legacy rows are
-- "ungrouped" (root of the list). ON DELETE SET NULL means removing a group
-- does not cascade-delete its annotations.
--
-- Down:
--   ALTER TABLE annotation_objects DROP COLUMN IF EXISTS group_id;
--   DROP TABLE IF EXISTS annotation_groups;

CREATE TABLE IF NOT EXISTS annotation_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id uuid NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  parent_group_id uuid REFERENCES annotation_groups(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200),
  ordinal integer NOT NULL DEFAULT 0,
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS annotation_groups_map_idx ON annotation_groups(map_id);
CREATE INDEX IF NOT EXISTS annotation_groups_parent_idx ON annotation_groups(parent_group_id);

ALTER TABLE annotation_objects
  ADD COLUMN IF NOT EXISTS group_id uuid
    REFERENCES annotation_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS annotation_objects_group_idx ON annotation_objects(group_id);
