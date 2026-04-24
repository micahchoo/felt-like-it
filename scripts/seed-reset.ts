/**
 * Reset + re-seed the adversarial-testing fixtures.
 *
 * Deletes the fixture users (alice, bob) — cascade removes their maps,
 * layers, features, shares, and api_keys — then re-invokes the seed script.
 *
 * Called by Playwright globalSetup. Demo user and SF-parks map are untouched.
 *
 * Usage: pnpm seed:reset
 *   or:  DATABASE_URL=postgresql://... tsx scripts/seed-reset.ts
 */

import pg from 'pg';
import { FIXTURE_USERS } from '../apps/web/src/lib/server/db/fixtures.js';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://felt:felt@localhost:5432/felt';

async function reset(): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const res = await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [
      [FIXTURE_USERS.alice.id, FIXTURE_USERS.bob.id],
    ]);
    console.log(`Removed ${res.rowCount ?? 0} fixture user(s) (cascade drops all owned rows).`);
  } finally {
    await client.end();
  }
}

await reset();

// Opt in to fixture creation — seed.ts gates alice/bob behind this flag so
// a stray production `pnpm seed` cannot create backdoor credentials.
process.env['SEED_FIXTURES'] = '1';

// Re-run seed to recreate fixtures. tsx resolves the relative import.
await import('./seed.js');
