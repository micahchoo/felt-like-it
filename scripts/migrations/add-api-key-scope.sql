ALTER TABLE api_keys ADD COLUMN scope text NOT NULL DEFAULT 'read';
