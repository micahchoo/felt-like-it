-- Track per-user file uploads for quota enforcement and cleanup
CREATE TABLE user_uploads (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_id     TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  file_size   INTEGER NOT NULL,
  stored_path TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX user_uploads_user_id_idx ON user_uploads (user_id);
CREATE INDEX user_uploads_created_at_idx ON user_uploads (created_at);
