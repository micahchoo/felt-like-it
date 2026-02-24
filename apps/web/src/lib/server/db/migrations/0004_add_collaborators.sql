-- Map collaborators (per-map granular permissions)
CREATE TABLE IF NOT EXISTS map_collaborators (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id      UUID        NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- 'viewer' | 'commenter' | 'editor'
  role        TEXT        NOT NULL DEFAULT 'viewer',
  invited_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(map_id, user_id)
);

CREATE INDEX IF NOT EXISTS map_collaborators_map_id_idx  ON map_collaborators (map_id);
CREATE INDEX IF NOT EXISTS map_collaborators_user_id_idx ON map_collaborators (user_id);
