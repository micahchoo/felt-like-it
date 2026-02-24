-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- Users table
CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" text NOT NULL,
  "hashed_password" text NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "users_email_idx" ON "users" ("email");

-- Sessions table (Lucia auth — text PK)
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" text PRIMARY KEY,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL
);

-- Maps table
CREATE TABLE IF NOT EXISTS "maps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "viewport" jsonb NOT NULL DEFAULT '{"center":[-98.35,39.5],"zoom":4,"bearing":0,"pitch":0}',
  "basemap" text NOT NULL DEFAULT 'osm',
  "is_archived" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "maps_user_id_idx" ON "maps" ("user_id");

-- Layers table
CREATE TABLE IF NOT EXISTS "layers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "map_id" uuid NOT NULL REFERENCES "maps"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "type" text NOT NULL DEFAULT 'mixed',
  "style" jsonb NOT NULL DEFAULT '{}',
  "visible" boolean NOT NULL DEFAULT true,
  "z_index" integer NOT NULL DEFAULT 0,
  "source_file_name" text,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "layers_map_id_idx" ON "layers" ("map_id");

-- Features table (PostGIS geometry)
CREATE TABLE IF NOT EXISTS "features" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "layer_id" uuid NOT NULL REFERENCES "layers"("id") ON DELETE CASCADE,
  "geometry" geometry(Geometry, 4326) NOT NULL,
  "properties" jsonb NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "features_layer_id_idx" ON "features" ("layer_id");
CREATE INDEX IF NOT EXISTS "features_geometry_idx" ON "features" USING GIST ("geometry");

-- Share links table
CREATE TABLE IF NOT EXISTS "shares" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "map_id" uuid NOT NULL REFERENCES "maps"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "access_level" text NOT NULL DEFAULT 'unlisted',
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "shares_token_idx" ON "shares" ("token");
CREATE INDEX IF NOT EXISTS "shares_map_id_idx" ON "shares" ("map_id");

-- Import jobs table
CREATE TABLE IF NOT EXISTS "import_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "map_id" uuid NOT NULL REFERENCES "maps"("id") ON DELETE CASCADE,
  "layer_id" uuid REFERENCES "layers"("id") ON DELETE SET NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "file_name" text NOT NULL,
  "file_size" integer NOT NULL DEFAULT 0,
  "error_message" text,
  "progress" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT NOW(),
  "updated_at" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "import_jobs_map_id_idx" ON "import_jobs" ("map_id");
CREATE INDEX IF NOT EXISTS "import_jobs_status_idx" ON "import_jobs" ("status");

-- Auto-update updated_at via trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users', 'maps', 'layers', 'features', 'shares', 'import_jobs']
  LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER update_%s_updated_at BEFORE UPDATE ON %s FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()',
      t, t
    );
  END LOOP;
END;
$$;
