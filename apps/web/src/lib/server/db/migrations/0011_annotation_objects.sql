-- 0011_annotation_objects.sql
-- Phase A: Annotation Object System
--
-- Creates the new annotation object store alongside the legacy annotations table.
-- The legacy table is NOT dropped here — that happens in 0012 after code verification.
--
-- Tables created:
--   annotation_objects    — flat object store with JSONB anchor/content
--   annotation_changelog  — immutable change log for undo/redo, audit, webhooks
--   annotation_templates  — user-defined slot compositions
--   annotation_webhooks   — event-driven push notifications
--
-- Tables altered:
--   api_keys — add map_id, permission, expires_at for scoped API keys

-- ─── annotation_objects ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS annotation_objects (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id        UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    parent_id     UUID REFERENCES annotation_objects(id) ON DELETE CASCADE,
    author_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name   TEXT NOT NULL,
    anchor        JSONB NOT NULL,
    content       JSONB NOT NULL,
    template_id   UUID,  -- FK added in annotation_templates creation below
    ordinal       INTEGER NOT NULL DEFAULT 0,
    version       INTEGER NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS annotation_objects_map_created_idx
    ON annotation_objects(map_id, created_at ASC);
CREATE INDEX IF NOT EXISTS annotation_objects_thread_idx
    ON annotation_objects(map_id, parent_id, ordinal);
CREATE INDEX IF NOT EXISTS annotation_objects_template_idx
    ON annotation_objects(template_id);
-- GIN index for JSONB anchor type queries (e.g. WHERE anchor->>'type' = 'point')
CREATE INDEX IF NOT EXISTS annotation_objects_anchor_gin_idx
    ON annotation_objects USING GIN(anchor);

-- ─── annotation_changelog ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS annotation_changelog (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id          UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    object_id       UUID NOT NULL,  -- intentionally no FK (survives object deletion)
    object_version  INTEGER NOT NULL,
    author_id       UUID REFERENCES users(id) ON DELETE SET NULL,
    author_name     TEXT NOT NULL,
    operation       TEXT NOT NULL,  -- 'add' | 'mod' | 'del'
    patch           JSONB NOT NULL,
    inverse         JSONB NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS annotation_changelog_map_time_idx
    ON annotation_changelog(map_id, created_at ASC);
CREATE INDEX IF NOT EXISTS annotation_changelog_object_idx
    ON annotation_changelog(object_id, created_at ASC);
CREATE INDEX IF NOT EXISTS annotation_changelog_undo_idx
    ON annotation_changelog(map_id, author_id, created_at DESC);

-- ─── annotation_templates ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS annotation_templates (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    description         TEXT,
    slots               JSONB NOT NULL,
    default_anchor_type TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS annotation_templates_user_name_idx
    ON annotation_templates(user_id, name);

-- Add FK from annotation_objects.template_id → annotation_templates.id
ALTER TABLE annotation_objects
    ADD CONSTRAINT annotation_objects_template_fk
    FOREIGN KEY (template_id) REFERENCES annotation_templates(id)
    ON DELETE SET NULL;

-- ─── annotation_webhooks ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS annotation_webhooks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id      UUID NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url         TEXT NOT NULL,
    secret      TEXT NOT NULL,
    events      TEXT[] NOT NULL DEFAULT '{*}',
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS annotation_webhooks_map_idx
    ON annotation_webhooks(map_id);

-- ─── Extend api_keys ─────────────────────────────────────────────────────────

ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS map_id     UUID REFERENCES maps(id) ON DELETE CASCADE;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS permission TEXT;
ALTER TABLE api_keys ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- ─── Migrate existing annotation data ────────────────────────────────────────

INSERT INTO annotation_objects (
    id, map_id, parent_id, author_id, author_name,
    anchor, content, template_id, ordinal, version,
    created_at, updated_at
)
SELECT
    id, map_id, NULL, user_id, author_name,
    jsonb_build_object(
        'type', 'point',
        'geometry', ST_AsGeoJSON(anchor_point)::jsonb
    ),
    jsonb_build_object('kind', 'single', 'body', content),
    NULL, 0, 1,
    created_at, updated_at
FROM annotations;

-- Synthetic changelog entries for migrated data.
-- NOTE: These use camelCase keys in the snapshot to match application-level format.
-- Migrated entries are audit-only — undo is not supported for pre-migration data.
INSERT INTO annotation_changelog (
    map_id, object_id, object_version, author_id, author_name,
    operation, patch, inverse, created_at
)
SELECT
    ao.map_id, ao.id, 1, ao.author_id, ao.author_name,
    'add',
    jsonb_build_object('op', 'add', 'object', jsonb_build_object(
        'id', ao.id,
        'mapId', ao.map_id,
        'parentId', ao.parent_id,
        'authorId', ao.author_id,
        'authorName', ao.author_name,
        'anchor', ao.anchor,
        'content', ao.content,
        'templateId', ao.template_id,
        'ordinal', ao.ordinal,
        'version', ao.version,
        'createdAt', ao.created_at,
        'updatedAt', ao.updated_at
    )),
    jsonb_build_object('op', 'del', 'object_id', ao.id::text),
    ao.created_at
FROM annotation_objects ao;
