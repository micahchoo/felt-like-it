/**
 * Admin CLI — manage users from the command line.
 *
 * Commands:
 *   create-user <email> <name> <password> [--admin]
 *   reset-password <email> <new-password>
 *   promote <email>
 *   demote <email>
 *   list-users
 *
 * Usage: pnpm admin <command> [...args]
 *   or:  DATABASE_URL=postgresql://... tsx scripts/admin-cli.ts <command> [...args]
 */

import pg from 'pg';
import { hash } from '@node-rs/argon2';

const DATABASE_URL =
  process.env['DATABASE_URL'] ?? 'postgresql://felt:felt@localhost:5432/felt';

const ARGON2_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
} as const;

const [command, ...args] = process.argv.slice(2);

async function main(): Promise<void> {
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();

  try {
    switch (command) {
      case 'create-user': {
        const [email, name, password] = args;
        if (!email || !name || !password) {
          console.error('Usage: admin create-user <email> <name> <password> [--admin]');
          process.exit(1);
        }
        const isAdmin = args.includes('--admin');
        const hashedPassword = await hash(password, ARGON2_OPTIONS);
        await client.query(
          'INSERT INTO users (id, email, hashed_password, name, is_admin) VALUES (gen_random_uuid(), $1, $2, $3, $4)',
          [email, hashedPassword, name, isAdmin]
        );
        console.log(`User created: ${email}${isAdmin ? ' (admin)' : ''}`);
        break;
      }

      case 'reset-password': {
        const [email, newPassword] = args;
        if (!email || !newPassword) {
          console.error('Usage: admin reset-password <email> <new-password>');
          process.exit(1);
        }
        const hashedPassword = await hash(newPassword, ARGON2_OPTIONS);
        const res = await client.query(
          'UPDATE users SET hashed_password = $1, updated_at = NOW() WHERE email = $2',
          [hashedPassword, email]
        );
        if ((res.rowCount ?? 0) === 0) {
          console.error(`No user found with email: ${email}`);
          process.exit(1);
        }
        console.log(`Password reset for: ${email}`);
        break;
      }

      case 'promote': {
        const [email] = args;
        if (!email) {
          console.error('Usage: admin promote <email>');
          process.exit(1);
        }
        const res = await client.query(
          'UPDATE users SET is_admin = true, updated_at = NOW() WHERE email = $1',
          [email]
        );
        if ((res.rowCount ?? 0) === 0) {
          console.error(`No user found with email: ${email}`);
          process.exit(1);
        }
        console.log(`Promoted to admin: ${email}`);
        break;
      }

      case 'demote': {
        const [email] = args;
        if (!email) {
          console.error('Usage: admin demote <email>');
          process.exit(1);
        }
        const res = await client.query(
          'UPDATE users SET is_admin = false, updated_at = NOW() WHERE email = $1',
          [email]
        );
        if ((res.rowCount ?? 0) === 0) {
          console.error(`No user found with email: ${email}`);
          process.exit(1);
        }
        console.log(`Demoted from admin: ${email}`);
        break;
      }

      case 'list-users': {
        const { rows } = await client.query<{
          email: string;
          name: string;
          is_admin: boolean;
          created_at: Date;
        }>('SELECT email, name, is_admin, created_at FROM users ORDER BY created_at');
        if (rows.length === 0) {
          console.log('No users found.');
        } else {
          console.log(`${'Email'.padEnd(40)} ${'Name'.padEnd(25)} ${'Admin'.padEnd(7)} Created`);
          console.log('-'.repeat(100));
          for (const row of rows) {
            console.log(
              `${row.email.padEnd(40)} ${row.name.padEnd(25)} ${(row.is_admin ? 'yes' : 'no').padEnd(7)} ${row.created_at.toISOString().slice(0, 10)}`
            );
          }
        }
        break;
      }

      default:
        console.error('Unknown command. Available: create-user, reset-password, promote, demote, list-users');
        process.exit(1);
    }
  } finally {
    await client.end();
  }
}

await main();
