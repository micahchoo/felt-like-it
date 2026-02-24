import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';
import { env } from '$env/dynamic/private';

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL ?? 'postgresql://felt:felt@localhost:5432/felt',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;

// Re-export schema for convenience
export * from './schema.js';
