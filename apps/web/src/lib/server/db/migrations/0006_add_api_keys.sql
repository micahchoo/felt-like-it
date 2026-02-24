-- Migration 0006: API keys for programmatic Bearer token access
-- Keys are stored as SHA-256 hashes; plaintext is shown once at creation time.

CREATE TABLE api_keys (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  -- SHA-256 hex digest of the raw "flk_<64-hex>" key
  key_hash    TEXT        NOT NULL,
  -- First 12 characters of the raw key (e.g. "flk_a1b2c3d4") shown in the UI
  prefix      TEXT        NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX api_keys_key_hash_idx ON api_keys (key_hash);
CREATE INDEX        api_keys_user_id_idx  ON api_keys (user_id);
