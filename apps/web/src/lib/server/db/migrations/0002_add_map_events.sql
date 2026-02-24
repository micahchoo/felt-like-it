-- Map activity event log.
-- Records user-initiated actions (layer imports, viewport saves, etc.)
-- for the per-map activity feed.  Cascades on map delete.

CREATE TABLE IF NOT EXISTS map_events (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id      UUID        NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  user_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT        NOT NULL,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS map_events_map_id_idx    ON map_events (map_id);
CREATE INDEX IF NOT EXISTS map_events_created_at_idx ON map_events (created_at DESC);
