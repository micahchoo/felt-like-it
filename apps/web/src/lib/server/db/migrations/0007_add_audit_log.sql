-- Migration 0007: Audit log — tamper-evident append-only record of data mutations.
-- Each row's chain_hash is SHA-256(content + prev_hash), forming a hash chain.
-- Tampering with any row invalidates all subsequent hashes.

CREATE TABLE audit_log (
  -- Monotonic sequence — used to order the hash chain
  seq          BIGSERIAL    PRIMARY KEY,
  -- Null when the originating user's account has been deleted
  user_id      UUID         REFERENCES users(id) ON DELETE SET NULL,
  -- Dot-namespaced action verb, e.g. 'map.create', 'collaborator.invite'
  action       TEXT         NOT NULL,
  -- Top-level entity kind: 'map', 'share', 'collaborator', 'apiKey'
  entity_type  TEXT         NOT NULL,
  -- UUID (or other ID) of the affected entity, stored as text
  entity_id    TEXT,
  -- Map this mutation belongs to (null for account-level events like apiKey)
  map_id       UUID         REFERENCES maps(id) ON DELETE SET NULL,
  -- Structured context (title, role, accessLevel, etc.)
  metadata     JSONB,
  -- Hash-chain tamper evidence
  prev_hash    TEXT         NOT NULL,   -- chain_hash of the previous row (64 zeros for first)
  chain_hash   TEXT         NOT NULL,   -- SHA-256(content + prev_hash)
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_map_id_idx     ON audit_log (map_id);
CREATE INDEX audit_log_user_id_idx    ON audit_log (user_id);
CREATE INDEX audit_log_created_at_idx ON audit_log (created_at);
