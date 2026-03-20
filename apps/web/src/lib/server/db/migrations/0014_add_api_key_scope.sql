-- Migration 0014: Add scope column to api_keys
-- The Drizzle schema declares this column but it was never added to the DB.
-- Default 'read' matches the schema default. Existing keys get 'read-write'
-- since they were created before scoping existed and should retain full access.

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'read';

-- Backfill existing keys to read-write (they predate scoping)
UPDATE api_keys SET scope = 'read-write' WHERE scope = 'read';
