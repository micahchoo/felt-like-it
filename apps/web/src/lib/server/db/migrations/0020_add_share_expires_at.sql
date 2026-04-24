-- F13.3 (2026-04-25): optional expiration timestamp for share links.
-- Owner can opt into a TTL when creating/updating a share; resolveShareToken
-- rejects tokens whose expiration is in the past. NULL means "no expiration"
-- (default — preserves the prior unconditional behaviour).

ALTER TABLE shares
  ADD COLUMN expires_at TIMESTAMPTZ NULL;

-- The expired-token check pattern is `expires_at IS NOT NULL AND expires_at < NOW()`.
-- Tokens are looked up by token value (already uniquely indexed); the expires_at
-- comparison runs at most once per request and against an indexed-by-PK row,
-- so no additional index is needed.
