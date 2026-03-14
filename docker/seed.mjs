/**
 * Auto-seed for Docker first boot.
 * Creates a default admin user if no users exist.
 * Safe to run on every startup — skips if any user already exists.
 *
 * Override defaults with environment variables:
 *   SEED_ADMIN_EMAIL    (default: admin@felt-like-it.local)
 *   SEED_ADMIN_PASSWORD (default: admin)
 *   SEED_ADMIN_NAME     (default: Admin)
 */
import pg from 'pg';
import { hash } from '@node-rs/argon2';

const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://felt:felt@localhost:5432/felt';
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@felt-like-it.local';
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin';
const ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? 'Admin';

async function seed() {
  const Client = pg.default?.Client ?? pg.Client;
  const client = new Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();

    // Skip if any users exist
    const { rows } = await client.query('SELECT 1 FROM users LIMIT 1');
    if (rows.length > 0) {
      console.log('  Users already exist — skipping seed.');
      return;
    }

    const hashedPassword = await hash(ADMIN_PASSWORD, {
      memoryCost: 19456,
      timeCost: 2,
      outputLen: 32,
      parallelism: 1,
    });

    await client.query(
      'INSERT INTO users (id, email, hashed_password, name, is_admin) VALUES (gen_random_uuid(), $1, $2, $3, true)',
      [ADMIN_EMAIL, hashedPassword, ADMIN_NAME]
    );

    console.log(`  Admin user created: ${ADMIN_EMAIL}`);
  } catch (err) {
    // Non-fatal — don't block startup if seed fails
    console.error('  Seed warning:', err.message);
  } finally {
    await client.end();
  }
}

await seed();
