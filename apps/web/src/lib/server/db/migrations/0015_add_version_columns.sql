-- 0015_add_version_columns.sql
-- Add optimistic concurrency version columns to maps and layers.
-- Reversible: ALTER TABLE maps DROP COLUMN version; ALTER TABLE layers DROP COLUMN version;

ALTER TABLE maps ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE layers ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
