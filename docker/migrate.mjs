/**
 * Standalone migration runner for Docker containers.
 * Reads SQL files from MIGRATIONS_DIR and applies them idempotently.
 * Safe to run concurrently from web + worker (uses advisory lock).
 */
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://felt:felt@localhost:5432/felt';
const MIGRATIONS_DIR = process.env.MIGRATIONS_DIR ?? '/app/migrations';

// Unique lock ID to avoid collision with other apps sharing the same Postgres
const LOCK_ID = 7367746;

async function migrate() {
  const Client = pg.default?.Client ?? pg.Client;
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();

    // Advisory lock prevents concurrent migration from web + worker
    await client.query(`SELECT pg_advisory_lock(${LOCK_ID})`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const filename of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [filename]
      );
      if (rows.length > 0) {
        console.log(`  skip ${filename}`);
        continue;
      }

      console.log(`  apply ${filename}...`);
      const sql = readFileSync(resolve(MIGRATIONS_DIR, filename), 'utf-8');

      // Wrap each migration in a transaction (PostgreSQL DDL is transactional)
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [filename]
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('Migrations complete.');
  } catch (err) {
    console.error('Migration failed:', err);
    throw err;
  } finally {
    try { await client.query(`SELECT pg_advisory_unlock(${LOCK_ID})`); } catch { /* connection may be gone */ }
    await client.end();
  }
}

await migrate();
