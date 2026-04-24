-- H5: Idempotency-Key support for POST endpoints.
-- Caches (status, body, content-type) keyed by (user_id, key) for 24h replay.
-- Method+path recorded so the same key reused against a different endpoint
-- can be rejected (422) instead of silently returning a wrong cached payload.
CREATE TABLE idempotency_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER NOT NULL,
  response_body BYTEA NOT NULL,
  content_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idempotency_keys_user_key_idx
  ON idempotency_keys(user_id, key);
CREATE INDEX idempotency_keys_created_at_idx
  ON idempotency_keys(created_at);
