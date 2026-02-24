-- 0005_add_annotations.sql
-- Geographic annotations: map-anchored media pins.
--
-- Content types (discriminated on the `type` JSONB field):
--   text   — plain text note (max 5 000 chars)
--   emoji  — single emoji character with optional label
--   gif    — animated GIF URL with optional alt text
--   image  — static image URL with optional caption
--   link   — URL with optional title and description (link card)
--   iiif   — IIIF Presentation API manifest URL with optional NavPlace GeoJSON
--
-- anchor_point is a PostGIS geometry(Point, 4326) — always WGS84.
--   Read coordinates:  ST_X(anchor_point) = longitude, ST_Y(anchor_point) = latitude
--   Write coordinates: ST_GeomFromGeoJSON('{"type":"Point","coordinates":[lng,lat]}')
--
-- content JSONB is validated by AnnotationContentSchema (Zod) at the application
-- layer — the DB stores the raw JSON without a CHECK constraint so new content
-- types can be added via a schema-only migration.

CREATE TABLE IF NOT EXISTS annotations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Cascade delete: removing a map removes all its annotations
    map_id       UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    -- SET NULL on user deletion so annotations survive account removal
    user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    -- Author name denormalized at insert time (mirrors comments.author_name)
    -- No JOIN needed when listing; survives user deletion
    author_name  TEXT NOT NULL,
    -- WGS84 Point anchor — GIST-indexed for future proximity queries
    anchor_point geometry(Point, 4326) NOT NULL,
    -- AnnotationContentSchema: { type, ...variant-fields }
    -- Keyed on `type` ('text'|'emoji'|'gif'|'image'|'link'|'iiif')
    content      JSONB NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Composite index for fast map-scoped chronological listing (the primary query pattern)
CREATE INDEX IF NOT EXISTS annotations_map_id_created_at_idx
    ON annotations(map_id, created_at ASC);

-- Spatial index (GIST) for future proximity queries (ST_DWithin, KNN lookups)
CREATE INDEX IF NOT EXISTS annotations_anchor_point_idx
    ON annotations USING GIST(anchor_point);
