import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { env } from '$env/dynamic/private';
import { logger } from '../logger.js';

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL ?? 'postgresql://felt:felt@localhost:5432/felt',
  max: parseInt(env.DB_POOL_MAX ?? '20', 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: parseInt(env.DB_STATEMENT_TIMEOUT_MS ?? '10000', 10),
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected PostgreSQL pool error');
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;

// Re-export schema for convenience
export * from './schema.js';
