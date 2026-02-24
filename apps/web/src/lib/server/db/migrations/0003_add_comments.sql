-- Map comment threads (Phase 3 collaboration).
-- author_name is denormalized at insert time so comments survive user deletion.
-- resolved allows the map owner to mark a thread as addressed.

CREATE TABLE IF NOT EXISTS comments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id      UUID        NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT        NOT NULL,
  body        TEXT        NOT NULL,
  resolved    BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS comments_map_id_idx    ON comments (map_id);
CREATE INDEX IF NOT EXISTS comments_created_at_idx ON comments (created_at ASC);
