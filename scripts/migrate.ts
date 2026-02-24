/**
 * Applies SQL migrations to the database, skipping any already applied.
 * Tracks state in a `schema_migrations` table (created on first run).
 *
 * Usage: pnpm migrate
 *   or:  DATABASE_URL=postgresql://... tsx scripts/migrate.ts
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://felt:felt@localhost:5432/felt';

const MIGRATIONS_DIR = resolve(
  __dirname,
  '../apps/web/src/lib/server/db/migrations'
);

const MIGRATION_FILES = ['0000_initial.sql', '0001_add_map_templates.sql', '0002_add_map_events.sql', '0003_add_comments.sql', '0004_add_collaborators.sql'];

async function migrate(): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database.');

    // Create tracking table if it doesn't exist
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    for (const filename of MIGRATION_FILES) {
      const filePath = resolve(MIGRATIONS_DIR, filename);

      // Check if already applied
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename]
      );
      if (rows.length > 0) {
        console.log(`  ↳ ${filename} already applied, skipping.`);
        continue;
      }

      console.log(`  ↳ Applying ${filename}…`);
      const sql = readFileSync(filePath, 'utf-8');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename) VALUES ($1)',
        [filename]
      );
      console.log(`  ✓ ${filename} applied.`);
    }

    console.log('✓ All migrations complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

await migrate();
