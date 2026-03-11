# Database Schema

PostgreSQL 16 + PostGIS 3.4. All primary keys are UUIDs except `sessions.id` (text, Lucia requirement) and `audit_log.seq` (bigserial).

## Users & Auth

### users
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| email | text | UNIQUE, NOT NULL | |
| hashed_password | text | NOT NULL | argon2 hash |
| name | text | NOT NULL | Display name |
| is_admin | boolean | DEFAULT false | Admin panel access |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

### sessions
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | text | PK | Lucia requirement — not UUID |
| user_id | uuid | FK → users ON DELETE CASCADE | |
| expires_at | timestamptz | NOT NULL | |

### api_keys
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| user_id | uuid | FK → users ON DELETE CASCADE | |
| name | text | NOT NULL | User-assigned label |
| key_hash | text | UNIQUE, NOT NULL | SHA-256 hash of `flk_<64-hex>` |
| prefix | text | NOT NULL | First 12 chars for identification |
| last_used_at | timestamptz | | Updated on each use |
| created_at | timestamptz | DEFAULT now() | |

## Maps & Layers

### maps
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| user_id | uuid | FK → users ON DELETE CASCADE | Owner |
| title | text | NOT NULL | |
| description | text | | |
| viewport | jsonb | NOT NULL, DEFAULT `{"center":[-98.35,39.5],"zoom":4,"bearing":0,"pitch":0}` | `{ center, zoom, bearing, pitch }` |
| basemap | text | NOT NULL, DEFAULT 'osm' | OSM / satellite / custom URL |
| is_template | boolean | DEFAULT false | Template maps available to all users |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

### layers
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| map_id | uuid | FK → maps ON DELETE CASCADE | |
| name | text | NOT NULL | |
| type | text | NOT NULL | `point`, `line`, `polygon`, or `mixed` |
| style | jsonb | | FSL-compatible style schema |
| visible | boolean | DEFAULT true | |
| z_index | integer | DEFAULT 0 | Rendering order |
| source_file_name | text | | Original import filename |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

### features
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| layer_id | uuid | FK → layers ON DELETE CASCADE | |
| geometry | geometry(Geometry, 4326) | NOT NULL | PostGIS; stored via `ST_GeomFromGeoJSON`, read via `ST_AsGeoJSON` |
| properties | jsonb | DEFAULT '{}' | Arbitrary key-value attributes |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

## Collaboration

### map_collaborators
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| map_id | uuid | FK → maps ON DELETE CASCADE | |
| user_id | uuid | FK → users ON DELETE CASCADE | |
| role | text | NOT NULL | `viewer`, `commenter`, or `editor` |
| invited_by | uuid | FK → users | |
| created_at | timestamptz | DEFAULT now() | |

UNIQUE constraint on `(map_id, user_id)`.

### shares
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| map_id | uuid | FK → maps ON DELETE CASCADE | |
| token | text | UNIQUE, NOT NULL | URL token for public access |
| access_level | text | NOT NULL | `public` or `unlisted` |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

### comments
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| map_id | uuid | FK → maps ON DELETE CASCADE | |
| user_id | uuid | FK → users ON DELETE SET NULL | Nullable — survives user deletion |
| author_name | text | | Denormalized for display after user deletion |
| body | text | NOT NULL | |
| resolved | boolean | DEFAULT false | |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

## Annotations

### annotations (v1 — legacy)
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| map_id | uuid | FK → maps ON DELETE CASCADE | |
| user_id | uuid | FK → users ON DELETE SET NULL | |
| author_name | text | | Denormalized |
| anchor_point | geometry(Point, 4326) | | PostGIS point |
| content | jsonb | NOT NULL | `AnnotationContent` discriminated union |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

### annotation_objects (v2 — current)
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| map_id | uuid | FK → maps ON DELETE CASCADE | |
| parent_id | uuid | FK → annotation_objects | Nullable; self-referential for threading |
| author_id | uuid | FK → users ON DELETE SET NULL | |
| author_name | text | | Denormalized |
| anchor | jsonb | NOT NULL | Discriminated union: point, region, feature, viewport |
| content | jsonb | NOT NULL | Single or slotted content wrapper |
| template_id | uuid | FK → annotation_templates | SQL-level table only (not in Drizzle schema) |
| ordinal | integer | DEFAULT 0 | Order within thread |
| version | integer | DEFAULT 1 | Optimistic concurrency control |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

### annotation_changelog
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| map_id | uuid | FK → maps ON DELETE CASCADE | |
| object_id | uuid | NOT NULL | Not a FK — survives object deletion |
| object_version | integer | | |
| author_id | uuid | FK → users ON DELETE SET NULL | |
| author_name | text | | |
| operation | text | NOT NULL | `add`, `mod`, or `del` |
| patch | jsonb | NOT NULL | Forward patch |
| inverse | jsonb | NOT NULL | Reverse patch (for undo) |
| created_at | timestamptz | DEFAULT now() | |

## Activity & Audit

### map_events
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| map_id | uuid | FK → maps ON DELETE CASCADE | |
| user_id | uuid | FK → users ON DELETE SET NULL | |
| action | text | NOT NULL | Dot-namespaced (e.g. `viewport.saved`) |
| metadata | jsonb | | |
| created_at | timestamptz | DEFAULT now() | |

### audit_log
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| seq | bigserial | PK | Sequential, not UUID |
| user_id | uuid | FK → users ON DELETE SET NULL | |
| action | text | NOT NULL | Dot-namespaced |
| entity_type | text | | `map`, `share`, `collaborator`, `apiKey` |
| entity_id | text | | |
| map_id | uuid | FK → maps ON DELETE SET NULL | |
| metadata | jsonb | | |
| prev_hash | text | | Previous entry's chain hash |
| chain_hash | text | | SHA-256 of `seq + action + entity + prev_hash` |
| created_at | timestamptz | DEFAULT now() | |

Tamper-evident: uses `pg_advisory_xact_lock` for serialized hash chain insertion.

### import_jobs
| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | uuid | PK | |
| map_id | uuid | FK → maps ON DELETE CASCADE | |
| layer_id | uuid | FK → layers | Nullable until import creates the layer |
| status | text | NOT NULL | `pending`, `processing`, `done`, or `failed` |
| file_name | text | NOT NULL | |
| file_size | integer | NOT NULL, DEFAULT 0 | Bytes |
| error_message | text | | Set on failure |
| progress | integer | | 0-100 |
| created_at | timestamptz | DEFAULT now() | |
| updated_at | timestamptz | DEFAULT now() | |

## Migrations

SQL files in `apps/web/src/lib/server/db/migrations/`, named `NNNN_description.sql`. Applied automatically:
- **Docker:** `docker/docker-entrypoint.sh` runs `docker/migrate.mjs` before the app starts. Uses advisory locks for safe concurrent startup (web + worker).
- **Local dev:** `pnpm migrate` (or automatically via `pnpm dev:up`). Auto-discovers files via `readdirSync`.

State tracked in `schema_migrations` table (filename → applied_at). Idempotent — re-running skips already-applied migrations.
