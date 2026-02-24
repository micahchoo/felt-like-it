-- Add is_template column to maps table.
-- Template maps are visible to all users and can be cloned as a starting point.
-- They are owned by a user (typically seeded) but returned by listTemplates without userId filter.

ALTER TABLE maps ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS maps_is_template_idx ON maps (is_template) WHERE is_template = true;
