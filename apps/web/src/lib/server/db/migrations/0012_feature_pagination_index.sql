-- Composite index for paginated feature queries (listPaged endpoint).
-- Covers ORDER BY created_at with layer_id equality filter.
CREATE INDEX IF NOT EXISTS idx_features_layer_created
  ON features (layer_id, created_at);
